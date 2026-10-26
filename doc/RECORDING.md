# Recording a game and playing it back

CSBWin can record a game as the list of inputs it took and play that list back. The port
has neither yet (`DEBT.md` G29). This document holds what CSBWin does, what a replay needs,
where the port stands against those needs, and what sharing recordings would take.

**The engine settles first.** Any change to what the engine does at a tick makes every
recording made before it play out differently, so G29 waits until the debt that changes
behaviour is paid. The work that comes before it is the list under "The port against those
needs" below.

## CSBWin's recorder

`RECORDFILE` (`doc/CSBwin-src/Recording.cpp:864-1300`), opened by the "Record" menu item
(`doc/CSBwin-src/CSBUI.cpp:966-979`), writes `logs/RecordNNNNN.log`, the first free number
(`Recording.cpp:873-1000`). The file is:

- a `#` version line (`szCSBVersion`), then `#` comment lines naming the button codes and
  the `#` options a player can add by hand (`Recording.cpp:908-972`);
- one line per mouse-queue entry the game takes, `time x y num random`, as
  `%08x %04x %04x %04x %08x` (`Recording.cpp:1258-1283`): `d.Time`, the entry's
  coordinates and button code, and `d.RandomNumber`. That is 33 bytes a line.

What is recorded:

- Every entry `_HandleMouseEvents` takes, past its frozen-game discard and held-step test
  (`doc/CSBwin-src/Mouse.cpp:1634-1645`), and a click in the viewport through
  `HandleClickInViewport` (`Mouse.cpp:1032-1252`), once on each of its paths
  (`doc/PROVEN_FACTS.md` → "`totalMoveCount` counts every mouse-queue entry
  `HandleMouseEvents` takes, once"). The no-op, button 0x64 at (0x114, 0x2f), is not
  (`Recording.cpp:1097-1103`).
- A new game's seed: `0x3333` with `d.RandomNumber` split into `x` and `y`
  (`doc/CSBwin-src/SaveGame.cpp:1626-1635`).
- A game saved: `0x6668` with the save file's signature (`SaveGame.cpp:1324-1333`). A game
  read: `0x6669` with the read file's (`SaveGame.cpp:1714-1717`).
- The files' signatures: `0x6666` `graphics.dat`, `0x666a` `CSBgraphics.dat`, `0x6667`
  `dungeon.dat`, `0x6665` the version. Each is written once at the first entry that finds
  it known, and again whenever `d.RandomNumber` happens to match a mask
  (`Recording.cpp:1234-1257`).

**A recording consumes random draws.** Writing a signature draws once
(`RECORDFILE::Signature`, `Recording.cpp:1043-1055`). While the clock runs and no playback
is open, an entry taken when `(d.RandomNumber & 0x3651) == 0` also writes `0x2221` and
draws `gameSpeed + 1` times (`RECORDFILE::CycleRandom`, `Recording.cpp:1033-1041`,
`:1229-1233`). So a game recorded does not draw the same numbers as the same game
unrecorded; the recording carries the lines that reproduce its own draws.

`RECORDFILE::Record` also counts `totalMoveCount`, recording or not (`doc/PROVEN_FACTS.md`,
same section). Conflux 3.5's Extended Features block sets `AutoRecord` (0x10,
`RecordDesignOption`, `SaveGame.cpp:403-404`): a game read from it records unless the
command line or the menu says not to (`SaveGame.cpp:2588-2603`).

## CSBWin's player

`PLAYFILE` (`Recording.cpp:152-849`), opened by the "Playback" menu item or the `PLAY`
command-line key (`CSBUI.cpp:980-987`, `:2180-2186`, `:2222-2228`), reads `Playfile.log`:

- **It replaces the mouse queue.** At the top of `_HandleMouseEvents`, unless gravity is
  moving the party, it empties the queue and puts the next recorded entry in it, or
  returns if there is none due (`Mouse.cpp:1493-1505`). Live input is ignored.
- **An entry is due once `d.Time` reaches its time** (`Recording.cpp:481-482`), so one
  entry is taken per pass of the loop at most, and wall time plays no part.
- **The random value is the drift detector.** A due entry whose `random` is neither
  `d.RandomNumber` nor the number of draws since the last entry, outside the codes that
  set or skip the stream, stops with "Sequence/timing error / Should we quit?"; going on
  sets `d.RandomNumber` to the recorded value (`Recording.cpp:483-503`).
- **A new game takes its seed from the file**: the `0x3333` line sets `d.RandomNumber`
  (`Recording.cpp:633-638`), and a new game whose first entry is not `0x3333` offers to
  quit, "Replay Starting Random Error" (`SaveGame.cpp:1606-1621`).
- **Signatures are checked and redrawn.** A signature line different from the file read
  warns once, "Recorded with Different … File", and draws as the recorder did
  (`Recording.cpp:656-722`). A `0x2221` line redraws the recorder's cycle
  (`:650-653`).
- **`#` lines set options**: `#DMRules`/`#NoDMRules`, `#NeophyteSkills`,
  `#ExtraTicks`/`#NoExtraTicks`, `#SpeedLimit`/`#NoSpeedLimit`, `#FastVBLnn`, `#NoSound`,
  `#NoSleep`, and the trace switches (`Recording.cpp:271-440`).
- **Playback turns `extraTicks` off** (`CSBUI.cpp:985`, `:2186`, `:2227`), which a
  `#ExtraTicks` line turns back on (`Recording.cpp:301-309`). Why playback needs it off is
  not established.
- The player also reads three compressed line forms, of one to three fields, each an index
  into a table of earlier lines (`Recording.cpp:443-477`); the recorder writes only the
  five-field form.
- An `annotation.txt` beside it prints its lines in the message area at their times
  (`Recording.cpp:505-611`).

### Saves inside a recording

A save changes the game's state, as the Atari program's did (`Recording.cpp:736-746`). A
recording with saves in it replays only by saving at the same entries. CSBWin's fixes are
lines written by hand into the file: `0x2223` stands in for a save removed from it, and
`0x2224` splices two recordings, by doing what the save and the read would have done to the
state (`TAG00bd40`, `ProcessMonstersOnLevel`, `SmartDiscard(true)`; for `0x2224` four more
`totalMoveCount` and the attack menu closed, `Recording.cpp:734-761`). A `0xdddd` line
writes a word anywhere in `d.`, "to make the playback work" (`Recording.cpp:672-680`).

## What a replay needs

The inputs and the seed are not enough on their own. A replay plays the game out the same
way only from:

1. **the same starting state**: a new game of the same data set, or the very save the
   recording started from (`0x6669`);
2. **the same seed**, which a new game's `0x3333` carries and a save holds;
3. **the same rules**: `DM_rules`, and the port's extras that change play
   (`Extras` in `src/engine/GameContext.ts`: `gatherThrownWeapons`, `drinkAtFountain`,
   `unlimitedKeyQueue`), and any change of them during the game, recorded where it
   happens;
4. **every input stamped with the tick at which the engine took it**, `d.Time`, in the
   order taken;
5. **an engine that, given those, does the same thing at every tick**, whatever the frame
   rate, the machine and the wall clock.

## The port against those needs

What holds:

- **The random stream is CSBWin's**, one LCG in the game's context
  (`src/core/random.ts`), restored from a save (`src/engine/RuntimeSave.ts:166`). Its seed
  comes from `Math.random()` once, at the first draw (`random.ts:47`), which a recording
  would write down as CSBWin's `0x3333` does.
- **Drawing has its own stream**, `viewportRandom`, as CSBWin's `DrawViewport` does
  (`src/renderer/bytecode/ViewportDrawState.ts:24-33`); nothing under `src/renderer` or `src/ui` draws from
  the game's.
- **The engine reads no clock**: under `src/engine` and `src/core`, `Date.now()` serves
  only the loop's pacing (`src/engine/Game.ts:501-520`) and a save's date
  (`src/engine/GameSaves.ts`), and `Math.random()` only the seed. Its arithmetic is
  integer; the one `Math.sin` builds MD5's constants (`src/core/md5.ts:14`).
- **Input reaches the engine through CSBWin's one mouse queue** (`src/engine/MouseQueue.ts`),
  and the port already counts `totalMoveCount` where CSBWin records
  (`Game.recordFileRecord`, `src/engine/Game.ts:1002`).

What breaks determinism:

- **The attack menu's damage flash is timed on the wall clock.** The panel's tick does
  nothing while `host.attackFlashHeld()` (`src/engine/AttackMenu.ts:117-119`), which is
  `FLASH_MS` (400 ms) of `performance.now()` (`src/renderer/ui/Attack.ts:274-286`), where
  CSBWin's `VBLDelay(15)` stops the game (`DEBT.md` H). Whether the attack options are
  back at a given tick, and so what a click on them does, depends on real time.

What is not verified:

- **Anything counted in VBLs within a tick.** Several entries taken in one tick are taken
  in the same order, but not necessarily at the same VBL as when recorded. Every VBL-driven
  state the engine reads must be checked: the held-step test, `extraTicks` (always on in
  the port, `src/engine/MovementSystem.ts:115-116`), the eye held down, the attack menu's
  tick.
- **Input that reaches the game outside the queue**: the page's dialogs (settings, map,
  champions), F5 and F9, the save menu's SAVE and its reads, and the pointer's other
  wall-clock uses (`nowMs`, `src/renderer/ui/UIState.ts:488`: the menu button's press, the
  message area's double click and long press, the mouth's chew).
- **The port's saves**: whether a save changes the game's state where CSBWin's does, so
  that a recording with saves in it replays.

**The proof is a tool**: a headless `tools/checks/replay.ts` that plays a scripted game,
records it, replays it at another frame pacing, and asserts `d.RandomNumber` equal at every
entry and the two final saves byte-identical. It is the first step of G29, and a
regression test of everything at once.

## Recordings made in CSBWin

Playing back CSBWin's own recordings needs, beyond the above, the port's random draws to
follow CSBWin's draw for draw, and the recorder's own draws (signatures, `0x2221`)
reproduced. Every line's `random` then points at the first divergence, which makes such a
recording an end-to-end test of the whole port. A recording cannot be written by hand, nor
by a solver such as `tools/solve-3d2d1d.ts`: every line needs its exact tick and random
state. A port-only recorder does not need this compatibility.

## Shared recordings

Not decided; what sharing would take:

- **Storage**: 33 bytes an entry, kept in IndexedDB beside the saves
  (`src/data/saves/BrowserSaveStore.ts`) while recording, and sent to the server to share.
- **A starting point the viewer has**: a new game of a published data set, or the starting
  save uploaded with the recording. A player's own unpublished set cannot be shared this
  way.
- **The engine's version**, stored with each recording: a behaviour change makes older
  recordings drift, which their `random` values show at the first wrong entry. A shared
  recording is then either played by the build it was made with or marked broken. This is
  why the engine settles first.
- **Speed**: fast-forward is free, as CSBWin's `#NoSpeedLimit` and `#FastVBLnn`; going
  back means replaying from the start, or from saves taken along the way.
