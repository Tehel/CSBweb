# Recording a game and playing it back

CSBWin can record a game as the list of inputs it took and play that list back. The port
records every game and keeps it in the browser's store, and plays a recording back through
its player, which `?recording=` starts in the page. This document holds what CSBWin does,
what a replay needs, where the port stands against those needs, the port's own recorder
and player, and what sharing recordings would take.

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
  menu's SAVE with it stopped, each replayed by its tail alone; the Sleepsave, lying down
  and woken, by its file and its tail made again in the VBL of its click.
- **The replay shows no dialog and writes no save**: the disk menu a played VBL opens
  holds the clock with nothing shown, until the logged `pause` lets it run.
- **The doors it plays are the boundary's**: clicks, the button-up, keys, panel keys, the
  dialogs' clock, `TAG0207cc`, the extras, a save's tail and `?dev`'s move.
- **A recording's start is enough**: a new game's stream and playthrough as the read
  leaves them (the read draws from a stream of its own, seeded by `Math.random`,
  `Game.readNewGame`, which the replay's own read seeds anew, and the two are set over
  it), or the save's file; and the rules and the extras.
- **A read ends a recording**, and F9's begins the next from the save it reads.
- **The game's end ends one too, a point of its own**: a party the Stone Golem kills,
  every champion of `csbgame7.dat` at 1 HP. The recording ends in the VBL that asks for
  the credits, with `d.Word11694`, and records nothing after it; the prune at the next
  read's first write keeps it whole, though no save names a point in it. It replays to
  the same end, and a recording whose end is a VBL early or late, whose `d.Word11694` is
  not the game's, or that plays on past the game's end, drifts there.
- **The recordings make a tree** (below): a save names the recording and its point
  there; F9's read of it begins a branch of that point, which replays from its own start
  alone, and from its root through the join, where the root replayed up to the point
  makes the very file the branch read. Left out at the join, what the read left beside
  the file (`CarriedState`) makes the final saves differ.
- **The store holds a recording as it grows**: the replay plays the recording as the
  recorded page's store holds it, written every five seconds of its clock, over a store in
  memory that clones what it is given as IndexedDB does. Before its last write it holds
  the changes so far, what a page closed then leaves; a write that fails writes nothing
  and the next writes it all; the recording F9 replaced is finished, ended, at the next
  write; and one no save links, left in the store before, is gone at the first.
  `tools/probe-frames.ts` checks the IndexedDB half in a browser: a write of the game's
  recording read back as the recorder has it, a part added by a write after a click, the
  upgrade to version 7, a data set's DELETE taking its recordings, a write refused where
  the row is not as its page wrote it, a cut, and the running recording removed and
  written whole at the next write.
- **What no save reaches is pruned**: at a load, the recording replaced is cut at the
  last point a save or a branch names; a save deleted cuts its recording back to the one
  before it; a save written over removes a branch no save reaches any more, its parts
  with it; a recording the running branch joins is kept; another page's prune cuts the
  running branch, and its own page's next write writes it whole again. The branch still
  replays from its root through the join.
- **A point shared is a package** (below, "Shared recordings"): the path to F5's save in a
  branch, to the Sleepsave taken inside a VBL, and to the lost game's end, each written,
  read back the same and played from the package alone, a save's path to the very file
  the save holds, through its joins. A package whose save's file is not the path's
  drifts at its end, and one whose form is wrong is refused.

What is not verified:

- **An open chest under a running save**: the open chest repacked and opened again around
  the file's build (`GameSaves.save`) is not a change the boundary is told, and must leave
  the state as it was. The tool's games save with no chest open.
- **Whether a save changes the game's state where CSBWin's does**, so that a recording with
  saves in it replays as CSBWin's would.
- **That the boundary has every door**: the tool proves the doors it plays, not that
  nothing else of the page changes the game between two VBLs.
- **That `CarriedState` is all a read leaves**: the clock's hold and the loop's flags are
  what the read in `ReadGame.ts` does not set and the game reads on; the tool joins a
  branch F9 read with the clock running at a point the disk menu's SAVE held it, not a
  branch the disk menu's LOAD read.

## The port's recorder

Not CSBWin's format: playing CSBWin's own recordings back is not its aim (below). It logs
the boundary where the page changes the game (`src/engine/InputBoundary.ts`), each change
with the number of VBLs run before it, and the player applies each before the same VBL.

`Recorder` (`src/engine/Recorder.ts`) is the boundary's listener. The page has one
(`src/main.ts`), and writes what it records to the store as it grows (below). A
`Recording` is:

- the build that made it (`__CSBWEB_BUILD__`) and its data set's id;
- its start: a new game's stream and `d.RandomGameID`, or a save's file;
- the rules as its read left them (`RulesOptions`, process-wide globals in CSBWin, which a
  read changes only where its file has an Extended Features block), and the extras;
- every change the boundary is told, with the VBLs the recording had run before it,
  `d.Time` and `d.RandomNumber`;
- the VBLs it has run, and whether a read or the game's end has ended it, and the end
  (`Recording.end`, `RecordingEnd`), with `d.Word11694`.

The two reads in `GameSaves` begin one, the only places a game starts: a new game's once
its playthrough is drawn (`newGameRead`), a save's once it is read (`read`), the disk menu's
LOAD, F9, CONTINUE and RISE's adventure among them. The read itself is told at the boundary
(`readGame`), which ends the recording before. The boot then forces DM rules where the
dungeon asks, a change of the boundary's, the recording's first.

**The game's end** ends one as well: `ShowCredits` once `MainLoop` has returned, on a
game lost or won (`Game.mainLoopReturns`), told at the boundary with `d.Word11694`
(`InputBoundary.ended`). It is the game's own, made inside the VBL that ended it, so the
recording ends after that VBL and keeps the end: a point to share, as a save's is, that
no save can follow ("Shared recordings", below).

**The store** holds the recordings beside the saves, in the same IndexedDB database
(`doc/SAVES.md`), from version 7: a row each in `recordings` (`RecordingEntry`,
`src/data/saves/RecordingStore.ts`: its set, build, playthrough, when it began and was
last written, its VBLs, its changes and parts, whether a read or the game's end has ended
it, and that end, with when it ended and the game's play time then, `Game.playTime`,
which the writer takes as the game ends, `Recorder.onEnd`), and its parts
in `recordingParts`, keyed by the row's id and a `seq`. Part 0 is the head, the start, the
rules and the extras; each part after it the changes recorded since the one before, so a
write adds only what is new. A row and the parts it gains are written in one transaction,
and a row never names a part the store has not (`assembleRecording` refuses one that
does).

Most games end with the page closed, not with a read, so `RecordingWriter`
(`src/engine/RecordingWriter.ts`) writes the running recording while it runs: every five
seconds (`RECORDING_WRITE_MS`, `src/main.ts`) and as the page is hidden, the row whenever
its VBLs have moved and a part whenever it has new changes. A write that fails is written
again at the next. A recording a read has replaced is finished, ended, at the next write.
Nothing is written of a recording before its first change or the game's end, and its first write prunes
the store (below, "The tree"). Deleting a player's own data
set deletes the recordings played on it (`BrowserDataSetStore.remove`). The clock and the
ids are the page's: the engine reads neither.

A recording is played back by its start, and each change applied before the VBL it was
logged at (below, "The port's player").

### The tree

A save made in a recording knows its place there, and a load of it carries the
recording on from there, as a branch:

- **The link.** A save's row names the recording it was made in and its point there,
  as its file was made (`SaveEntry.recording`, `Recorder.point`): the recording's id,
  the changes recorded before it, the VBLs run, and whether it was taken inside the
  last of them (`inVbl`, the Sleepsave's). The changes past the point begin with
  the save's tail (`saveWritten`). The file stays CSBWin's.
- **A branch.** A read of a linked save begins a recording that names that point as its
  parent (`Recording.parent`). The read is not transparent, so the branch begins at it,
  from its own start: the save's file, and what the read left of the game that the file
  does not hold (`CarriedState`, `src/engine/Recorder.ts`): the clock a dialog holds and
  the main loop's flags, the VBLs into the tick and the video mode among them. A read
  under the disk menu's LOAD leaves the menu's held clock, F9's the running game's; at
  the save's point, the clock and the loop were as the save left them. A read of a save
  no link names (one imported, CSBWin's, a new adventure, one made before the link)
  begins a root, from its file.
- **A recording's history** is the path from its root to it. A branch plays from its own
  start alone, or as its path: the root's start, then each parent up to the point its
  child joins, the child's read and its `CarriedState` set over it, and on. At each join,
  the parent replayed up to the point makes the very file the child read, a drift
  detector of its own.
- **The store** keeps the parent in the row and the head (`RecordingEntry.parent`,
  `RecordingHead.parent`). `RecordingWriter` writes a branch as one only where the store
  holds its parent up to its point: a save whose recording a closed page never wrote that
  far is read as a root. It writes the recordings a read replaced before the one
  running, so a parent the page played is in the store before its branch.

**Pruning.** What no save, no game's end and no running game reaches is removed
(`RecordingWriter`, `prunePlan`). A recording is reached up to the last point a save names
in it or a branch kept branches from, and one the game's end ended and the running one
whole, with their parents: the prune never removes a game's end. One reached nowhere is
removed, and what it alone reached of its parent with it, up its path; one reached short
of what the store holds is cut at its last point: the changes before it kept, its last
part cut, the parts after it removed, its row ended there (`cutRecording`,
`src/data/saves/RecordingStore.ts`). The store is pruned at a recording's first write,
which follows the read that began it, so a load cuts the recording it ends at the
last save made in it; and at a save deleted or written over (`GameSaves.onRowGone`:
the save menu's DELETE, a SAVE over a row, F5's and the Sleepsave's slots), what that
save alone reached, up its path. A recording no save links, as those the store's version 7
held before the tree, goes at the first prune.

A game running in another tab is no game this page plays, so its recording can be cut
or removed here. Each write after a recording's first is held against its row: where the
row is not as the page last wrote it, nothing is written (`RecordingPrunedError`), and the
page writes the recording whole again, which owes no prune, so two tabs never prune each
other in turn.

CSBWin's player can align an entry only with a tick, `d.Time`, so whatever the game counts
in VBLs within a tick (the held-step test, the eye held, the attack menu's tick) must come
out the same wherever in the tick the entry falls, and playback turns `extraTicks` off.
Counted in VBLs, the game is a function of its start, its VBLs and the log, whatever
happens within a tick. Each change still carries `d.Time` and `d.RandomNumber`, CSBWin's
drift detector: a replay stops at the first that differs.

Logging the boundary rather than the entries the queue takes replays the queue itself: a
click a full queue drops, and the button a click turns out to be when it is taken.

## The port's player

`RecordingPlayer` (`src/engine/RecordingPlayer.ts`) plays a recording's path into a game:
a root and the branches down to the one played, or a branch alone, from its own start.

- **The start.** The path's first start is read: a new game's world, its stream and
  playthrough set over the read's (`Game.readNewGame` draws from a stream of its own), or
  a save's file and its `CarriedState`; then its rules and its extras. The game is
  started by its owner, as after any read.
- **The feed.** The boundary calls the player after every VBL, outside it
  (`InputBoundary.play`), and the player applies the changes logged before the next, so
  nothing of the page comes between. The player runs no VBL: a tool's loop or the page's
  runs them.
- **The joins.** Where a parent reaches the point its child names, the child's file is
  read, its `CarriedState` set over it, its rules and extras set, and its changes follow.
- **The drift detector.** Each change's `d.Time` and `d.RandomNumber` are checked before
  it is applied, and at each join the file the parent makes now, as the recorded save
  made it (`saveFileOf`, `src/engine/GameSaves.ts`), against the file the child read;
  at a point taken inside a VBL, the file that VBL made (below); and a recording the
  game's end ended is played to it, the game ending in its last VBL with its
  `d.Word11694`, and a game that ends anywhere else drifts there; a path shared at a
  save's point is played to that point, and the file the game makes there checked
  against the save's (`SavedAtEnd`), as a join's.
  The first that differs stops the player (`RecordingPlayer.drift`).
- **What the game opens in a VBL** does its game half alone while a recording plays
  (`InputBoundary.playing`), and shows nothing: the disk menu its icon opens, and the
  prison's question, `TAG02076e`, the video mode and the clock held (`openSaveMenu`); the
  Hint Oracle's button, `TAG02076e` and the clock held (`stopForHintOracle`). The
  recording's logged `pause` and `tag0207cc` undo them, as their close did.
- **No save is written.** A save the page made is its logged tail (`saveWritten`). The
  Sleepsave's file and tail are made inside the VBL of its click, which the boundary does
  not log, so the player's game makes them again there and writes nothing
  (`GameSaves.sleepSave`); the file goes to the player (`InputBoundary.savedInVbl`).

**The page** plays one with `?recording=<id>` (`playRecording`, `src/main.ts`), by the
page's own loop. A store's id is the path the store holds to it, from its root
(`readRecordingPath`, `src/data/saves/RecordingStore.ts`). A store's save,
`save:<its row's id>` (`SAVE_POINT_PREFIX`, `src/engine/RecordingPoints.ts`), is the path the
store holds to its point, played to it and the save's file checked there, as a site's
(`readSavePoint`). A site's, sixteen uppercase
hexadecimal digits (`SHARED_RECORDING_ID`), is its package's path ("Shared recordings",
below), read from the server (`recordings/<id>.gz`) and never put in the store, played to
the point it was shared at, a save's file checked there. Every tick is drawn at
the wall clock's pace, times the viewer's (below). A span the clock is held through (`RecordingPlayer.held`), from the
change or the VBL that held it to the change that lets it run, is played at once and not
drawn (`Game.runAtOnceWhile`): its VBLs cannot be dropped, since a held clock still counts
the attack panel's flash, moves the message strip on, raises the due tick and runs the
mouse queue's pass. The player tells the page each span as it ends (`onSkipped`), and
a line in the message area says what was run at once: "SKIPPED 12S ON THE SAVE MENU",
its VBLs over sixty, rounded (`skippedLine`). What held the clock is what the stop that
began the span named (`InputBoundary.holder`): a dialog's logged `pause` names it
(`settings`, `map`, `champions`, `Dialog.name`), and so does the stop the disk menu and
the Hint Oracle make in a VBL (`saveMenu`, `hintOracle`); a logged stop recorded before
the name says "A MENU". The page's input reaches nothing of the game, and the page
records nothing, saves nothing and sends no statistic. At the path's end, or at a drift, the loop stops,
the screen as the recording left it, and a line in the message area says which: "THE
RECORDING ENDS HERE.", or "THE RECORDING DRIFTED FROM THE GAME HERE.", and, where the
recording that drifted was made by another build than the page's, "ANOTHER VERSION OF
THE SITE MADE IT." (`endLines`). The message area plays on alone until they are shown,
its scroll a VBL at the `d.Time` the loop stopped at (`runMessagesAlone`, `src/main.ts`).
The game's end is such a point: the credits are not played, a lost game's dying sound
alone, and the line says "THE GAME IS LOST HERE." or "THE GAME IS WON HERE." in place of
the recording's end, before the drift's where the recording drifted there. The screen
stays the page's, the strip over it as everywhere.

**The viewer's strip** (`src/renderer/ui/RecordingStrip.ts`) has the page's input while
a recording plays, drawn over the message area's top row, whose lines are then drawn a
row lower while its bottom row is empty, so the three rows shown hold the newest. From
the left, it shows four controls, which a click or a key works, in the order below, then
the time played flush right, the player's VBLs since the path's start
(`RecordingPlayer.vbls`) over sixty:

- **Pause** (Space): the loop held where it is (`Game.setPace(0)`), and on again.
- **RESTART** (Backspace): the path played again from its start in the same page, by a
  new player, once the page is put back as a new page has it (`rewindPage`): the loop
  stopped, its state a new loop's (`Game.resumeMainLoop`), the message area empty, the
  screen's play state its first, the clock running, and `totalMoveCount` 0. The clock is
  the page's: a path shared at a save the disk menu made ends under the menu's held clock,
  and a new game's read does not set it going. `totalMoveCount` is a global, not `d.`'s,
  which a new game's read counts on from and a saved game's sets: a page reads a new game
  at its boot alone, so a recording from one assumes 0, and the file a join checks holds
  it. `tools/checks/replay.ts` (point 11) restarts each package's path a second into its
  play, and again at its end, and plays it to the same end.
- **Stop** (Esc): the player and the loop stopped, and the page left for the welcome
  page.
- **The pace** (`+` and `-`, or a click, round from ×8 to ×1): the loop's VBLs to a VBL
  of the wall clock, 1, 2, 4 or 8 (`Game.setPace`). A span under a held clock is run at
  once at any pace.

RESTART and stop end the message area played on alone. While the loop does not run,
paused or at the end, a move of the pointer is drawn at the display's next frame
(`Presenter.animate`); the viewer's pointer is the cursor's place alone
(`GameScreen.setCursorPoint`), never the recorded game's, which the interface keeps
something of (`marchingOrderPointerMoved`).

**A branch of a Sleepsave** joins as any other, once the VBL has run. Its point is taken
inside the VBL of its click, before the rest of it, its tick among them, and says so
(`RecordingPoint.inVbl`): the join is checked against the file the played VBL made at the
same place (`InputBoundary.savedInVbl`), not one made after it. The recorded read came
after the VBL, so the branch is read after it too.

## Recordings made in CSBWin

Playing back CSBWin's own recordings needs, beyond the above, the port's random draws to
follow CSBWin's draw for draw, and the recorder's own draws (signatures, `0x2221`)
reproduced. Every line's `random` then points at the first divergence, which makes such a
recording an end-to-end test of the whole port. A recording cannot be written by hand, nor
by a solver such as `tools/solve-3d2d1d.ts`: every line needs its exact tick and random
state. A port-only recorder does not need this compatibility.

## Shared recordings

A player shares a point the store keeps, never a running game: a save, by its name, or
a game's end, won or lost. Its package, a recording's path and its metadata, is kept and
served by the server, which a moderator approves it on, and listed in the dialog the book
opens on a set's tile, where another player plays it. A recording of a set the site does
not publish is not shared; once the set is published, its recordings made before are,
since they name it by its id.

**The author is a name, never the `playerId`.** The `playerId` is what the server knows a
player by: the sets they own, and a moderator's rights (`X-Player-Id`, `server/app.ts`;
`doc/DEPLOYMENT.md`). A package names its author by the name the player gives, or by
nobody, and the server keeps its uploader's `playerId` apart, as a set's `owner` is
kept, for a withdrawal.

**A recording made by an older build** is listed with its build, and PLAY plays it all
the same; a drift stops it and says another version of the site made it (`endLines`).
Before a deploy, the replay tool (`utils/replay-recordings.ts`) plays every listed
recording against the new build and marks those that drift as broken, which the list
leaves out but for its uploader and the moderators.

**The browser's points** (`src/engine/RecordingPoints.ts`) are what a player plays and
shares of the store: each save whose recording the store holds up to its point
(`SaveEntry.recording`), and each recording the game's end ended. The book's dialog lists
a set's in its RECORDINGS tab (`src/ui/welcomePage.ts`), the latest made first, each with
what its package would say of it (`pointInfo`), its build and whether an extra was on; it
plays one by `?recording=`, and deletes a game's end, then prunes the store
(`pruneRecordings`, `src/engine/RecordingWriter.ts`), which is how one leaves it but by
its set's own deletion.

**The site's recordings** of a published set come first in that tab, as the server lists
them to the player (`siteRecordings`, `GET api/recordings?dataSet=<id>`), by title, the
latest shared first, each marked where an extra was on and with its state to whom the
server tells it: pending, hidden, broken, and "yours" to its uploader. A moderator whose
switch is off is listed them as a player is. The panel says its author, its description,
its metadata and when it was shared, with PLAY, `?recording=<id>`; to a moderator,
APPROVE on a pending one, HIDE or SHOW on any other, and DELETE, and to its uploader,
WITHDRAW (`POST api/recordings/<id>`). Each delete asks first, and the list is then the
server's anew, a refusal said in the dialog. A local set's book has no site's list.

**UPLOAD** shares a browser's point: its form in the panel takes a title, which it needs,
an author and a description (`RECORDING_TEXT_LIMITS`), then writes the point's package
and sends it (`uploadPoint`, `POST api/recordings`); the site's list is then asked anew,
the recording selected in it, pending until a moderator approves it. It is not offered
where the site would refuse it, and the panel says why: a local set, a pending one, or a
path that holds a move of `?dev` (`playedWithDevMoves`).

**The package** (`RecordingPackage`, `src/engine/RecordingPackage.ts`) is one file,
JSON gzipped by `CompressionStream`: the format's version, the build of the recording
shared, its data set, the metadata, the path and the point shared. The point is a
save's (`packageOfSave`): the path the store holds to the save's recording
(`readRecordingPath`), the last recording cut at the save's point, and the save's file,
which the path played to its end makes again, at a point taken inside a VBL as the
Sleepsave's is too. Or the game's end (`packageOfEnd`): the path to a recording the end
ended, which its replay reaches. Every recording before the last is cut at the point its
child joins it, so the package holds what the player plays and nothing after it. Each
recording is as the store holds it (`Recording`), a save's file in base64. The metadata
are the player's title, which it needs, author and description, plain text as long as a
set's name, authors and description may be (`RECORDING_TEXT_LIMITS`); when the path's
root began, when its point was made, the game's play time there (`Game.playTime`); and
where it starts, a new game or the save's level and champions, which is read from the
root, so it cannot disagree with it.

**The server** keeps the packages shared, lists them by set, serves them and moderates
them (`server/recordings.ts`, `doc/DEPLOYMENT.md` → "Shared recordings"). It reads a
package with the page's own reader, bundled for Node (`src/engine/PageReaders.ts`).

`readRecordingPackage` checks a package's form alone, the server's check: it unzips,
to no more than a limit its caller gives, parses, each field has its type (the rules,
the extras and the loop's flags their keys, each change its kind's fields, a read none),
the texts their limits, each recording its set and each branch its join at its parent's
end, and the point its path's end. It does not replay it.

**What a package costs**, measured by `tools/checks/replay.ts --measure`: a new game
played for an hour of its clock at a player's pace, a key or a click in the viewport
every second or so, F5 every three minutes and F9 every nine, shared at a last F5. Its
path is seven recordings and 3,883 changes; its package is 340 KB, 930 KB unzipped. A
save's file, about 61 KB, costs about 42 KB of it, once for each branch's start and once
for the save shared: a CSBWin file is scrambled, and gzip takes little off it. A change
costs about 11 bytes. So a package's size is the loads in its path more than its length.

What sharing takes:

- **Storage**: the store's recordings (above), sent to the server to share.
- **A starting point the viewer has**: a new game of a published data set, or the starting
  save uploaded with the recording. A player's own unpublished set cannot be shared this
  way.
- **The engine's version**, stored with each recording: a behaviour change makes older
  recordings drift, which their `random` values show at the first wrong entry. A shared
  recording is then either played by the build it was made with or marked broken, which
  the replay tool does before a deploy (`utils/replay-recordings.ts`).
- **Speed**: fast-forward is free, as CSBWin's `#NoSpeedLimit` and `#FastVBLnn`; going
  back means replaying from the start, or from saves taken along the way.
