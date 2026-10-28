# Recording a game and playing it back

CSBWin can record a game as the list of inputs it took and play that list back. The port
records every game in memory, and plays a recording back only in a tool so far (`DEBT.md`
G29). This document holds what CSBWin does, what a replay needs, where the port stands
against those needs, the port's own recorder, and what sharing recordings would take.

**Recordings follow the engine.** Any change to what the engine does at a tick makes a
recording made before it play out differently. A recording carries the build that made it,
and its `d.RandomNumber` values show the first entry where a later build parts from it.

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
  (`src/core/random.ts`), restored from a save (`src/engine/RuntimeSave.ts:98`). Its seed
  comes from `Math.random()` once, at the first draw (`random.ts:47`). A new game's stream
  also depends on the player's saves: `GameSaves.newGameRead` draws `d.RandomGameID` again
  while a save of the set holds it (`src/engine/GameSaves.ts:257-267`). So a recording
  starts from the stream as that leaves it, not from the seed alone.
- **Drawing has its own stream**, `viewportRandom`, as CSBWin's `DrawViewport` does
  (`src/renderer/bytecode/ViewportDrawState.ts:24-33`); nothing under `src/renderer` or `src/ui` draws from
  the game's.
- **The engine reads no clock.** The loop runs one VBL at a time (`Game.runFrame`), and the
  host's clock only decides how many run at each wake (`gameLoop`,
  `src/engine/Game.ts:490-516`). Under `src/engine` and `src/core`, `Date.now()` serves only
  a save's date (`src/engine/GameSaves.ts`), and `Math.random()` only the seed. Its
  arithmetic is integer; the one `Math.sin` builds MD5's constants (`src/core/md5.ts:14`).
- **Clicks and keys reach the engine through CSBWin's one mouse queue**
  (`src/engine/MouseQueue.ts`), a long press's click too, queued from a `setTimeout`. The
  port counts `totalMoveCount` where CSBWin records (`Game.recordFileRecord`,
  `src/engine/Game.ts:1043`).
- **The attack menu's damage flash is counted in VBLs**, the engine's
  (`ATTACK_FLASH_VBLS`, `src/engine/AttackMenu.ts`), where CSBWin's `VBLDelay(15)` stops
  the game (`DEBT.md` H).
- The page's wall-clock uses (`nowMs`, `src/renderer/ui/UIState.ts`), a menu button's
  press and the mouth's chew, only draw, a menu's under a stopped clock.

- **The page changes the game through one door**, its input boundary (`Game.input`,
  `src/engine/InputBoundary.ts`), at the moment its events come: a click, the button-up
  and a key queued; a panel key's action and the Reincarnate screen's keys and clicks,
  which the interface applies; `ctx.state.paused`, which the dialogs and the Hint Oracle
  hold and release, and under which a tick that comes due waits for the clock to run;
  `TAG0207cc` as the disk menu and the Oracle close; the settings' extras and the queue's
  length; a save's tail, `Game.saveWritten`, which re-attaches the monsters and runs
  `SmartDiscard`, and with the clock stopped runs once the store's write is awaited;
  `?dev`'s moves; the boot's DM rules (`Game.forceDMRulesAtBoot`); and a read, which is
  told. The boundary applies each at once and tells
  its listener first, with `InputBoundary.vbls`, the VBLs run, on a count that never
  stops. What the game changes inside a VBL, as the disk menu its icon opens holds the
  clock, is its own: playing the VBL again makes it, so it is told to nobody
  (`tools/checks/input-boundary.ts`).

What a player must do:

- **Draw every tick it plays.** A click in the viewport is resolved through the picking the
  tick's `DrawViewport` leaves, so playback draws, at the wall clock's pace or faster.

**The proof is a tool**, `tools/checks/replay.ts`. It stands up a page without the DOM, the
engine, its `GameScreen` over a stand-in canvas, the page's `GameInput`, its `GameSaves`
over a store in memory, its `Recorder` and its settings, wired as `src/main.ts` wires
them, on a clock it moves itself. It reads a new game and `csbgame7.dat` as the page reads
them, with extras of its own, and plays them as a player plays them: pointer events and
keys handed to `GameInput` between wakes of the loop of uneven length, the screen composed
after each input and at every VBL that asks. Then it plays each recording back in a fresh
page that has nothing else of the game, and draws only the tick's `DrawViewport`, and
asserts every change recorded at the same VBL with the same `d.Time` and
`d.RandomNumber`, and the two final saves byte-identical. So, for what the two games do:

- **Nothing the page composes takes from the game's stream**, nor changes what the game
  reads: beyond the tick's views, the recorded page composes the screen about a hundred
  times in each game, and the replay a handful.
- **A save leaves the game as the boundary says**: F5 with the clock running, and the disk
  menu's SAVE with it stopped, each replayed by its tail alone. The replay takes the disk
  menu down itself, where the log lets the clock run.
- **The doors it plays are the boundary's**: clicks, the button-up, keys, panel keys, the
  dialogs' clock, `TAG0207cc`, the extras, a save's tail and `?dev`'s move.
- **A recording's start is enough**: a new game's stream and playthrough as the read
  leaves them (the read draws from a stream of its own, seeded by `Math.random`,
  `Game.readNewGame`, which the replay's own read seeds anew, and the two are set over
  it), or the save's file; and the rules and the extras.
- **A read ends a recording**, and F9's begins the next from the save it reads.

What is not verified:

- **An open chest under a running save**: the open chest repacked and opened again around
  the file's build (`GameSaves.save`) is not a change the boundary is told, and must leave
  the state as it was. The tool's games save with no chest open.
- **Whether a save changes the game's state where CSBWin's does**, so that a recording with
  saves in it replays as CSBWin's would.
- **That the boundary has every door**: the tool proves the doors it plays, not that
  nothing else of the page changes the game between two VBLs.

## The port's recorder

Not CSBWin's format: playing CSBWin's own recordings back is not its aim (below). It logs
the boundary where the page changes the game (`src/engine/InputBoundary.ts`), each change
with the number of VBLs run before it, and the player applies each before the same VBL.

`Recorder` (`src/engine/Recorder.ts`) is the boundary's listener. The page has one
(`src/main.ts`), which keeps the recording begun last in memory: the store is to come
(`DEBT.md` G29). A `Recording` is:

- the build that made it (`__CSBWEB_BUILD__`) and its data set's id;
- its start: a new game's stream and `d.RandomGameID`, or a save's file;
- the rules as its read left them (`RulesOptions`, process-wide globals in CSBWin, which a
  read changes only where its file has an Extended Features block), and the extras;
- every change the boundary is told, with the VBLs the recording had run before it,
  `d.Time` and `d.RandomNumber`;
- the VBLs it has run, and whether a read has ended it.

The two reads in `GameSaves` begin one, the only places a game starts: a new game's once
its playthrough is drawn (`newGameRead`), a save's once it is read (`read`), the disk menu's
LOAD, F9, CONTINUE and RISE's adventure among them. The read itself is told at the boundary
(`readGame`), which ends the recording before. The boot then forces DM rules where the
dungeon asks, a change of the boundary's, the recording's first.

A recording is played back by its start: the game read from it, a new one's stream and
playthrough set over the read's, the rules and the extras set, the game begun, and each
change applied before the VBL it was logged at.

CSBWin's player can align an entry only with a tick, `d.Time`, so whatever the game counts
in VBLs within a tick (the held-step test, the eye held, the attack menu's tick) must come
out the same wherever in the tick the entry falls, and playback turns `extraTicks` off.
Counted in VBLs, the game is a function of its start, its VBLs and the log, whatever
happens within a tick. Each change still carries `d.Time` and `d.RandomNumber`, CSBWin's
drift detector: a replay stops at the first that differs.

Logging the boundary rather than the entries the queue takes replays the queue itself: a
click a full queue drops, and the button a click turns out to be when it is taken.

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
  recording is then either played by the build it was made with or marked broken.
- **Speed**: fast-forward is free, as CSBWin's `#NoSpeedLimit` and `#FastVBLnn`; going
  back means replaying from the start, or from saves taken along the way.
