# Recording a game and playing it back

CSBWin can record a game as the list of inputs it took and play that list back. The port
records every game and keeps it in the browser's store, and plays a recording back through
its player, which `?recording=` starts in the page. This document holds what CSBWin does,
what a replay needs, where the port stands against those needs, the port's own recorder
and player, and what sharing recordings would take.

**Recordings follow the engine.** Any change to what the engine does at a tick makes a
recording made before it play out differently. A recording carries the build that made it,
and its `d.RandomNumber` values show the first entry where a later build parts from it.
It also carries the engine's level it was played at, so that a later engine can play it
by the behaviour it was made with ("A recording's level", below), and the digest of each
file its set had read.

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
  starts from the stream as that leaves it, not from the seed alone, and from the seed
  too: the read draws for the groups of the party's level (below).
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
  the game (`DEBT.md` H). It only draws: the buttons are back in the game at the next
  tick, as CSBWin's.
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
- **A recording's start is enough**: a new game's seed, the stream its read began from,
  and its stream and playthrough as the read leaves them, or the save's file; and the
  rules and the extras. The read draws `d.RandomGameID`, then for the groups of the party's
  level as `ProcessMonstersOnLevel` loads them (`Game.readNewGame`), so the replay's read
  takes the seed, and the stream and playthrough are set over it
  (`tools/checks/new-game-seed.ts`, on Conflux, whose level 0 has groups). A recording made
  before the seed was kept reads from a stream of its own, which plays the same only where
  that level has no group, Dungeon Master's Hall of Champions among them.
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

Not CSBWin's format: CSBWin's own recordings are played into it, not read by it (below,
"Recordings made in CSBWin"). It logs
the boundary where the page changes the game (`src/engine/InputBoundary.ts`), each change
with the number of VBLs run before it, and the player applies each before the same VBL.

`Recorder` (`src/engine/Recorder.ts`) is the boundary's listener. The page has one
(`src/main.ts`), and writes what it records to the store as it grows (below). A
`Recording` is:

- the build that made it (`__CSBWEB_BUILD__`) and its data set's id;
- the engine's level it was played at (`ctx.behaviour.level`, below), and the MD5 of each
  file its set had read as it began, by name (`FileDigests`: the page reads its set's files
  through `digestedFiles`, `src/data/DataSetFiles.ts`);
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
`src/data/saves/RecordingStore.ts`: its set, build, level, playthrough, when it began and was
last written, its VBLs, its changes and parts, whether a read or the game's end has ended
it, and that end, with when it ended and the game's play time then, `Game.playTime`,
which the writer takes as the game ends, `Recorder.onEnd`), and its parts
in `recordingParts`, keyed by the row's id and a `seq`. Part 0 is the head, the start, the
rules, the extras and the files' digests; each part after it the changes recorded since the one before, so a
write adds only what is new. A row and the parts it gains are written in one transaction,
and a row never names a part the store has not (`assembleRecording` refuses one that
does). A row written before levels has none, and is of level 0; a head written before the
digests has none, and its recording names no files (`files` is `null`).

### A recording's level

`src/engine/Behaviour.ts` keeps the engine's level, `ENGINE_LEVEL`, and every old
behaviour the engine keeps beside the new (`BEHAVIOURS`), as CSBWin keeps 9.0's behind
`version90Compatible` (`doc/CSBwin-src/Recording.cpp:172-180`,
`doc/CSBwin-src/Code11f52.cpp:907-910`). Each is a flag, named for the behaviour it keeps,
with what it does, the debt ID of the commit that changed it and the level that commit
made (`until`). The engine reads them from `ctx.behaviour`, frozen: a game the page plays
is at `ENGINE_LEVEL`, every flag off (`CURRENT_BEHAVIOUR`), and the player sets each
recording's own before its read (`behaviourAt`), each flag whose `until` is above the
recording's level on. The level is 6. The flags of the port's own are `releaseScentLoops`,
until 2: the release's scents, which what FTL meant replaced (`DEBT.md` H, "The scents are
what FTL meant"); `magicDamageThroughArmour` and `skippedStepForgetsParty`, until 5:
magic damage to a champion multiplied by the armour's product, and a skipped step back
that forgets the party (`doc/PROVEN_FACTS.md` → "Magic damage to a champion skips the
armour", "A skipped step back reads the last `PossibleMove`'s `moveOntoPartyPosition`");
`actuatorWord8BigEndian`, until 6: a big actuator's `word8` read big-endian, which
loses bits 16-17 of a DSA's parameters (→ "A big actuator's `word8` stays in the file's
byte order"); `everyObjectFalls`, until 6: an actuator a DSA puts on an open pit
falling down it (→ "A pit takes only the party, a monster and what is above"); and
`chestWeighsFifty`, until 6: a chest of 5.0 kg in a dungeon that sets its weight (→ "A
chest weighs what the dungeon says").
Recordings made before
levels are of level 0.

A CSBWin version is a **profile** of the same flags (`PROFILES`): what that version did
where the engine does otherwise, where 2023's source does otherwise (each flag read from
the diff of its source against 2023's, `doc/CSBWIN_REFERENCE_INDEX.md` → "The older trees") or where the port parts from
CSBWin on purpose (`DEBT.md` H) and the version's runs need CSBWin's way. A flag of a
version's that the port never had has no `until`; a flag a profile plays names it with the
level it joined it at, and is on for a recording of that profile at that level or above.
A recording carries its profile beside its level (`Recording.profile`), as the store's row
and a package do; a game the page plays has none, and a recording made before profiles
neither. A CSBWin run is played at its version's profile (`CsbwinRun.profile`, `recordRun`;
`tools/play-csbwin-log.ts --profile=`), and the player sets a recording's before its read,
as its level. A path that holds a profile the engine does not play is refused before it
plays, as one of a later level. The profiles are `csbwin-2023`, for the runs of CSBWin
17.6 and 2023.05.20, and `csbwin-11.014`, for the 11.0xx runs. Both play `csbwinScentLoops`, joined at
level 2: CSBWin's scents (`src/engine/PartyFootprints.ts`), and
`csbwinDoorsSidewaysToMonsters`, joined at level 5: CSBWin's `PossibleMove`, which reads
every door as sideways (`MonsterPerception.possibleMove`, `DEBT.md` H). `csbwin-11.014` plays
`smartDiscardDrawnPriority` too, joined at level 1: 11.014's `SmartDiscard`, which ranks
every object it scans by a priority drawn afresh at each comparison (`smartDiscard11014`,
`src/engine/SmartDiscard.ts`), `tag016426StatisticIgnored`, joined at level 3: 11.014's
`TAG016426`, which reads every statistic as 0 (`ChampionDamage.attributeScaledReduction`),
and `missileRangeFromDexterity`, joined at level 4: a monster's missile's range from its
dexterity (`MonsterAttack.fillAttackParameters`). At it, `DMMovie42` plays to its end.

A run of an older version that does not play to its end yet is **under way**
(`CSBWIN_RUNS_UNDER_WAY`, `tools/lib/csbwinRun.ts`): its log is kept beside the others',
and `tools/checks/csbwin-runs.ts` plays it at its profile to the line where it first
drifts, and fails where it drifts anywhere else. A flag that takes it further moves that
line on in the same commit. None is under way: the next are the other 11.0xx runs
(`DEBT.md` F24).

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

### The policy

**A commit that may change what a tick does from the same inputs keeps the old behaviour
behind a flag and bumps the level, in that commit.** What it covers is whatever lies
between the input boundary and the state ("The port against those needs", above): the
engine, and the interface's hit tests and the viewport's picking that turn a logged click
into an action. A fix, a port of a CSBWin function, a refactor that turns out not to be
one: each counts, and "may" means a doubt is enough. The commit:

1. adds a flag to `BEHAVIOURS` (`src/engine/Behaviour.ts`), named for the behaviour it
   keeps, saying what that behaviour does, the commit's debt ID, and as its `until` the
   level the commit makes;
2. keeps the old lines verbatim behind it, `if (ctx.behaviour.<name>) { old } else { new }`,
   the new with its citation, where the engine reads the change; no old line is tidied,
   since a recording plays it;
3. bumps `ENGINE_LEVEL` by one, so that a game the page plays has the flag off and every
   recording made before it on.

**A level not yet deployed is joined, not bumped.** Only a deployed build records a
player's game, so a series of commits that will be deployed together shares one level: the
first bumps it, and each later one adds its flag with that level as its `until` and bumps
nothing. The level being built is named here until its deploy: **7**, which the scents'
fixes and the lone monster's sidestep make (`DEBT.md` C199 to C201); level 6 is deployed. A recording of the
author's dev server made between those commits may play differently, and is not kept.

A flag that joins a profile owes the same bump: the profile's recordings made before it
play it off, those made from its level on. It is named in the flag's `profiles`, with the
level the commit makes, and changes nothing for a game of no profile.

A change that only draws owes none, nor a new extra that is off by default; a change to an
extra's behaviour does. A refactor of tiers D and E changes no behaviour, which its
whole-output diff proves, so it owes none; where it finds a divergence, the fix is a
commit of its own and owes the flag. A flag is never removed: a player may import an old
recording at any time.

What proves it is the corpus, below, in `npm test`, and the site's recordings, which the
deploy plays. Each proves only what its recordings reach, so the flag is owed whether a
recording reaches the change or not.

### The corpus

A level bumped without its flag, or a change of play the commit did not count as one,
would break every recording made before it silently. So `npm test` plays a corpus of the
port's own recordings, `tools/fixtures/recordings/`, each package named for what it plays
and the level it was made at, `<name>.L<level>.gz` (`tools/lib/recordingCorpus.ts`).
`tools/checks/recording-corpus.ts` reads each by the page's reader, checks its name's
level against its own and against the levels the engine plays, and its recordings' files'
digests against the sets' files, to find the set it plays over ("The set a recording plays
over", below), then plays it from the package alone over that set
(`playPath`), each recording at its own level, to its point without a drift. A package is
never rewritten: at its level, it proves the flags of every later level keep its
behaviour. A new version of the package's format is the one exception, since the page
reads the latest alone: each package is converted in place, its name and its content kept
(`utils/migrate-recording-packages.ts --file`), in the commit that changes the format,
and plays to the same point, `d.Time`, `d.RandomNumber` and file before and after.

It holds CSBWin's runs (`CSBWIN_RUNS`, below: forty minutes of Dungeon Master to its end
each from 17.6, Chaos Strikes Back to Fulya Pit, Chaos Strikes Back's whole game from
2023.05.20, two and a half hours to its end, and `DMMovie42`, 11.017's Dungeon Master
to its end at `csbwin-11.014`) and three of `tools/checks/replay.ts`'s
packages: F5 in the new game's branch, the Sleepsave inside a VBL in `csbgame7.dat`'s, and
the lost game's end. The check asks for each run once, at any level (`--write` records
each the corpus has at none; `replay.ts --corpus` keeps its own three the same way). A bump
records nothing again, so the corpus grows only by new recordings: the old packages stay
and play with the flags on, and the flags off are what `tools/checks/csbwin-runs.ts` and
`replay.ts` play live at `ENGINE_LEVEL`. A run's recording is the same at every level,
its inputs being its log's.

A package the site serves (`recordings/<id>.gz`) names the site's set, whose id need not be
`tools/data-sets.json`'s (`dungeon-master-csbwin` for `dm-atari`'s files): the check plays
it over the set whose files it names, as the page does.

The site's own recordings are the deploy's corpus: `utils/deploy.sh` replays every one the
site shares with the build it is about to deploy, each at its level, and refuses the
deploy where one drifts (`utils/replay-recordings.ts`, `doc/DEPLOYMENT.md` → "Deploying").

### The set a recording plays over

A recording names its set by id, and carries the MD5 of each file the set had read as it
began (`Recording.files`). A set's files may change after it (a corrected `graphics.dat`
item, a moderator's new `dungeon.dat`), and the site may name a set's files by another id
than the manifest's (`dungeon-master-csbwin` for `dm-atari`'s). So the set a recording
plays over is found by its files (`findRecordingSet`, `src/data/RecordingSet.ts`): its own
where its files have every digest the path's recordings name, or else the first set, in
the manifest's order, whose files have them all. A path recorded before the digests names
none, and plays over its own set. Where no set has them, the recording is refused, and the
refusal says which file of its set no longer matches ("Dungeon Master's dungeon.dat no
longer matches the recording, and no other set on this site holds its files."), or that
its set is not on the site. Two recordings of a path that read one file with different
bytes are refused too: no set has both.

The page asks the server for the digests (`api/data-set-files`, `server/setFiles.ts`): the
MD5 of each game file (`GAME_FILES`, `src/data/DataSets.ts`) of each set the manifest offers
its player, a file digested once while its size and its time stay. It asks only to play a
recording that names files, before the page is built (`playedSetOf`, `src/main.ts`); a
local set's recording is matched against its record's files alone; and where the server
cannot answer, the recording plays over its own set, the console saying why. `?dungeon=`,
where given, must name the set found. The corpus (`tools/checks/recording-corpus.ts`) and
the deploy's gate (`utils/replay-recordings.ts`) find the set the same way, the corpus from
the repository's sets' files on disk (`diskSetDigests`), the gate from the instance's
answer. `tools/checks/recording-set.ts` proves the choice and the refusals,
`tools/checks/server.ts` the answer, and `tools/checks/replay-recordings.ts` the gate
playing over another set.

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
happens within a tick. Each change the store keeps still carries `d.Time` and
`d.RandomNumber`, CSBWin's drift detector, and a package keeps them every 64th change and
at each recording's last ("Shared recordings", below): a replay stops at the first that
differs.

Logging the boundary rather than the entries the queue takes replays the queue itself: a
click a full queue drops, and the button a click turns out to be when it is taken.

## The port's player

`RecordingPlayer` (`src/engine/RecordingPlayer.ts`) plays a recording's path into a game:
a root and the branches down to the one played, or a branch alone, from its own start.

- **The level.** A path that holds a level above `ENGINE_LEVEL`, a later build's in a
  stale tab, is refused before it plays: "A LATER VERSION OF THE SITE MADE THIS
  RECORDING". Each recording's behaviour is set before its read, the root's and each
  join's ("A recording's level", above).
- **The start.** The path's first start is read: a new game's world, read from its seed,
  its stream, playthrough and `totalMoveCount` set over the read's, or a save's file and its `CarriedState`; then its rules and its
  extras. `totalMoveCount` is a global, not `d.`'s, which a new game counts on from the
  page's last game, one lost at the entrance before it, and every save file holds: the
  recorder keeps it beside the stream, where it is not 0, and a recording made before it
  did assumes 0, as a page's first game has it; such a recording's files made after a game
  lost in its page differ there, its play the same. The game is
  started by its owner, as after any read.
- **The feed.** The boundary calls the player after every VBL, outside it
  (`InputBoundary.play`), and the player applies the changes logged before the next, so
  nothing of the page comes between. The player runs no VBL: a tool's loop or the page's
  runs them.
- **The joins.** Where a parent reaches the point its child names, the child's file is
  read, its `CarriedState` set over it, its rules and extras set, and its changes follow.
  A package's branch names the file by its MD5 alone (`RecordingStart`'s `join`): the
  file the parent makes there is checked against it, then read.
- **The drift detector.** Each change's `d.Time` and `d.RandomNumber` are checked before
  it is applied, where the recording keeps them (a package, every 64th change and each
  recording's last), and at each join the file the parent makes now, as the recorded save
  made it (`saveFileOf`, `src/engine/GameSaves.ts`), against the file the child read, or
  its MD5; at a point taken inside a VBL, the file that VBL made (below); and a recording
  the game's end ended is played to it, the game ending in its last VBL with its
  `d.Word11694`, and a game that ends anywhere else drifts there; a path shared at a
  save's point is played to that point, and the file the game makes there checked
  against the save's, or a package's MD5 of it (`SavedAtEnd`), as a join's.
  The first that differs stops the player (`RecordingPlayer.drift`), which names the
  first byte that differs where it has the file, and none where it has its MD5.
- **What the game opens in a VBL** does its game half alone while a recording plays
  (`InputBoundary.playing`), and shows nothing: the disk menu its icon opens, and the
  prison's question, `TAG02076e`, the video mode and the clock held (`openSaveMenu`); the
  Hint Oracle's button, `TAG02076e` and the clock held (`stopForHintOracle`). The
  recording's logged `pause` and `tag0207cc` undo them, as their close did.
- **No save is written.** A save the page made is its logged tail (`saveWritten`). Its
  file is made again before the tail and dropped: making it writes the running world's
  EXPOOL, the DSA globals and the overlay palette's records (`buildSaveFile`), as the
  recorded save did, and every later file holds what it wrote, so a game that saved
  before makes another file there than one that did not. The Sleepsave's file and tail are made inside the VBL of its click, which the boundary does
  not log, so the player's game makes them again there and writes nothing
  (`GameSaves.sleepSave`); the file goes to the player (`InputBoundary.savedInVbl`).

**The page** plays one with `?recording=<id>` (`playRecording`, `src/main.ts`), by the
page's own loop, over the set its files are found in ("The set a recording plays over",
above): the path is read before the page is built (`readPlayedRecording`), so the link
needs no `?dungeon=`, and one that names another set ends the page as an error. A store's id is the path the store holds to it, from its root
(`readRecordingPath`, `src/data/saves/RecordingStore.ts`). A store's save,
`save:<its row's id>` (`SAVE_POINT_PREFIX`, `src/engine/RecordingPoints.ts`), is the path the
store holds to its point, played to it and the save's file checked there, as a site's
(`readSavePoint`). Either, with `&from=` and `&to=` naming saves on its way (`WayPoint.id`,
below), is played from the one and to the other: the path is cut at `from` first, as
UPLOAD cuts it ("A path cut at a save", below), a bar on the canvas meanwhile
(`cutPlayedPath`), and ends at `to`, its file checked there where the store keeps its row;
one that cannot start there, or drifts before it, ends the page as an error does. A site's, sixteen uppercase
hexadecimal digits (`SHARED_RECORDING_ID`), is its package's path ("Shared recordings",
below), read from the server (`recordings/<id>.gz?v=3`, `recordingPackageUrl`) and never
put in the store, played to the point it was shared at, a save's file checked there. Every tick is drawn at
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
the left, it shows its controls, which a click or a key works, each an icon on a face of
its own between darker columns, in three groups with black between them: eject; stop,
ten minutes back and back, play and pause, forward and ten minutes forward; slower, the
pace, faster and loop. Slower's and faster's faces are 9 px wide to the others' 16, and
the columns 1 px, so that the faces and the black after them end at x 199, before the
time of a recording of ten hours or more, which begins at x 202. Then, after black,
flush right, the time played, the player's VBLs
since the path's start (`RecordingPlayer.vbls`) over sixty, over the path's length
(`RecordingPlayer.length`), which the time played reaches at its end:

- **Eject** (Esc): the player and the loop stopped, and the page left for the welcome
  page. Where the book's dialog played the recording, the page shows it as PLAY left
  it: its RECORDINGS, the recording selected, where it was played from and to, the tile
  selected under it. PLAY notes
  them in the tab's `sessionStorage`, and eject leads back with `#recording-stopped`
  (`RECORDING_STOPPED_HASH`), which the page takes off the address; it reads the note
  once, so another way back to the welcome page shows it as ever.
- **Stop** (Backspace): the path played again from its start in the same page, by a
  new player, once the page is put back as a new page has it (`rewindPage`): the loop
  stopped, its state a new loop's (`Game.resumeMainLoop`), the message area empty, the
  screen's play state its first, the clock running, and `totalMoveCount` 0. The clock is
  the page's: a path shared at a save the disk menu made ends under the menu's held clock,
  and a new game's read does not set it going. `totalMoveCount` is set by the start
  itself ("The start", above). The path is then run at once to its first tick, which
  draws the game, and paused there. `tools/checks/replay.ts` (point 11) restarts each
  package's path a second into its play, and again at its end, and plays it to the same
  end.
- **Back** (←, and Shift+← ten minutes): a minute of the path's VBLs back from where it
  stands, or from where a forward or a seek runs to, the path's start at most. The page
  is put back as stop puts it back, and the latest checkpoint the page keeps at or before
  the target ("Checkpoints", below) read by a new player, or the path played again from
  its start where none is (`seekBack`, `src/renderer/ui/RecordingStrip.ts`); then the path
  is run at once to the target as forward runs it, unheard, on through a span under a held
  clock it ends in, and on to a tick where none has run since the read, which draws the
  viewport (`seekLanded`): the read leaves the screen's viewport as it was, and drawing it
  outside a tick would draw from the game's random streams. Paused, it stays paused; at
  the path's end, it plays on unless paused; a forward while it runs adds to its target.
  Its faces are darker, and do nothing, where the target has nowhere near to start from:
  no checkpoint kept at or before it, and the path's start more than a minute before it
  (`KeptCheckpoints.reaches`), so that a seek never plays a long path again from its
  start. The checkpoints reach twenty minutes back from any VBL the play has passed, and
  within them a seek runs about a minute of the game at most. `tools/checks/replay.ts` (point 11) goes back in each package's play and lands on
  the game the uninterrupted play has at the target, its file and the player's place.
- **Play and pause** (Space): the loop held where it is (`Game.setPace(0)`), and on
  again. At the path's end, play is stop and play.
- **Forward** (→, and Shift+→ ten minutes): a minute of the path's VBLs run at once (`Game.forward`), five seconds
  of them a slice, the page let run and the screen drawn between, and none heard
  (`SoundManager.setMuted`); a span under a held clock it ends in is run to its end. A
  forward while one runs adds its minute or ten to it; paused, it stays paused. It runs past no
  end: the path's end or a drift stops it as it stops the loop. `tools/checks/replay.ts`
  (point 11) runs each package's path at once from its start to the same end.
- **Slower and faster** (`-`, and `+`, its key with or without Shift), the pace between
  them, which a click does not change: the loop's VBLs to a VBL of the wall clock, /4,
  /2, ×1, ×2, ×4 or ×8 (`Game.setPace`), a step a press, slower darker at /4 and faster
  at ×8. A span under a held clock is run at
  once at any pace.
- **Loop** (L): the path played again from its start two seconds after its end
  (`LOOP_DELAY_MS`), whatever ended it, as long as it is on; its face darker while it is.

Stop and eject end the message area played on alone.

**A branch of a Sleepsave** joins as any other, once the VBL has run. Its point is taken
inside the VBL of its click, before the rest of it, its tick among them, and says so
(`RecordingPoint.inVbl`): the join is checked against the file the played VBL made at the
same place (`InputBoundary.savedInVbl`), not one made after it. The recorded read came
after the VBL, so the branch is read after it too.

### A path cut at a save

A player plays and shares part of a path too: from a save it passes on its way, not from
its root (`src/engine/RecordingCut.ts`). A save's file read into a fresh game is not the
game that made it at any VBL: the read detaches and re-attaches every monster, which
re-makes their timers at `d.Time`. At a save's point, once its tail has run (`saveWritten`,
`MonsterSystem.reattachAfterSave`), the world, the monsters and the timers are a fresh
read's, and what the read loses is little (`CutState`, carried as `CarriedState.cut`):

- the attack menu and the rest of `ctx.interface`, which the read gives a new game's;
- the champion selected, and each champion's `load`, which the port keeps of its own;
- SmartDiscard's statics (`smartDiscardSnapshot`), 11.014's lists among them;
- `d.watchdogTime`, the mouse queue and the tick its last entry was taken at
  (`Game.lastInputTime`), which the read discards and zeroes;
- a game from a `dungeon.dat` without game information has none, and saves a size of 0,
  which a read turns into "No game information was provided"
  (`doc/CSBwin-src/SaveGame.cpp:256`), so that the next save is another file.

A cut starts there: the save's file read, its `CarriedState` and that state set over it,
and the changes after the save's tail, which the read stands in for, its VBLs counted from
the save. The game it starts resumes its loop where the save's point left it
(`Game.resumeAtSavePoint`): no tick is made due as `_MainLoop` opens, and no `TAG0138ec`,
which a read at the boot runs and the game that made the save did not. Without the attack
menu, or the champion selected, DMMovie42's saves drift; without the last, so does F5's
in the first recording of a new game, at the next file checked.

Where it can start (`cutPlace`): at a save whose tail is the next change of its
recording, F5's and the disk menu's under a held clock. F5's tail is at the save's VBL;
the disk menu's comes once the store has written the file, VBLs later in a browser, the
menu's clock held through them, so the path is replayed to the tail's VBL and the file
made there must still be the save's, where the store keeps its file; a save whose row was
written over has its tail all the same, and the cut takes the file the game makes there;
or at a join, a branch that read
the save, where the cut is the branch's own start, which plays alone ("The tree"). The
Sleepsave's tail is made inside the VBL of its click, which logs none, so a Sleepsave
starts a cut only at the join of a branch that read it. The path's end, a save or the
game's end, is cut as a package's is (`pointPath`), or at a save on its way
(`pathToWay`).

The state is the game's at the save: the path replayed headless up to it, undrawn but
for the tick's `DrawViewport`, in a page without the DOM (`standInPage`,
`src/renderer/StandInPage.ts`), the file made there checked against the save's
(`cutAtSave`); a branch whose file the store holds needs no replay. A drift before the
save refuses the cut. Replayed so, an hour of play takes a few seconds.

`tools/checks/recording-cut.ts` cuts every corpus package at every save on its path,
DMMovie42's nine disk menu saves among them, writes and reads back each cut's package, and
plays it to its end; and plays some without the attack menu, the champion selected or the
want of game information, which drift. `tools/checks/replay.ts` (point 8) cuts at a
branch that read a Sleepsave.

### Checkpoints

A checkpoint (`src/engine/Checkpoint.ts`) is the game between two VBLs as a path plays it,
kept in memory, never written: what the viewer's back goes back to (`seekBack`). The
player takes one (`RecordingPlayer.checkpoint`) after a VBL's feed (`onFed`), where no
`LoopScript` holds the loop (a generator cannot be kept), and a fresh page's player plays
on from it (`resume`) in place of `start`: the game read from it, at the behaviour of the
recording it was taken in, and the player's cursor where it stood, its recording, next
change, VBLs, joins and a span under a held clock. The game's next start resumes at the
point (`Game.resumeAtSavePoint`), which, besides what a cut skips, does not move a new
game's party onto its square again.

It starts from what a cut starts from, a save's file made at the point with its
`CarriedState` and `CutState`. At an arbitrary VBL that is not the game: the read
re-attaches the party level's monsters, drawing and making timers, and wakes a party
asleep, as CSBWin saves no sleep. So over the read go the runtime state taken beside the
file and its world (`getRuntimeSaveState`), the live timers as the game holds them (a
file's form collapses bytes 8-9), and what no file holds:

- `Game`'s own: the play time, whether the game was read from a save, the new game's seed,
  `d.CanRestartFromSavegame` and the paint held;
- the missile filter's timer and object, which every missile encounter reads, and
  `monsterDamageResult`;
- the monster AI's `d.` globals, whole, those that outlive a turn and those a call reads
  stale alike; `d.MonsterUnderAttack`; the monster attack's parameter block; the pool's
  count and the level whose monsters hold it; the party's generation;
- the DSAs' parameter blocks, and the filters' caches, which live as long as the system and
  hold the DSA found when each first looked, so that a fresh lookup is not the same;
- the actuators' delayed action, the hero text a candidate was read from, the skin cache
  (`SetSkin` can leave a byte its pool record does not hold) and a new game's Extended
  Features block, which a save's read leaves off the world;
- the screen's, which the page keeps for it (`GameHost.keptView`, `GameScreen.keptView`):
  the screen's share of `d` (`PlayState`: the mode, an inventory's, the attack menu's
  names), whose button lists a click goes through; the last `DrawViewport`'s picking, which
  a click in the viewport is resolved through until the next; and the drawing's statics,
  its two stacks and two random streams, which the next reads.

Making the file writes the world's `EXPOOL`, and makes one where the dungeon has none: the
take puts the pool back, so taking a checkpoint changes nothing, and the read puts it back
over the file's. A checkpoint takes 3 to 12 ms, and its read as long.

**The page keeps them** (`KeptCheckpoints`), across the players of the path it plays: one
at the first feed at or past each minute of the path (`RecordingPlayer.vbls`) after the
latest kept, playing or forwarding, where one can be taken, and the latest 21, so that the
play can always go back twenty minutes. A seek back reads the latest at or before its
target (`KeptCheckpoints.before`) by a new player in the same page once it is rewound
(`rewindPage`), and drops those after it, which the play takes again as it passes their
minutes; a drift in that play drops the checkpoint it was read from, which misled it, and
those it took after. Stop, which plays the path again from its start, drops them all. The
strip's back is such a seek.

`tools/checks/checkpoints.ts` plays each corpus package four times: without
checkpoints; taking one a minute, which ends on the same file; in a chain, each
checkpoint read into a fresh page, the engine read compared with the one that took it by a
recursive walk from `Game` (every field equal but the start's flag, so a field added
later that a checkpoint misses fails there), then played on to the next, and the last to
the path's end, with no drift and the same file; and back in the same page, as the viewer
goes back: the play keeping its 21, stopped at nine tenths of the path, rewound, and the
checkpoint at or before half of it, or twenty minutes back where that is later, read by a
new player, which lands on the file the game that took it made and plays to the same end.
A package shorter than four minutes takes one each quarter of its length.
`tools/checks/replay.ts` (point 11) keeps two of them in each package's play, a fifth of
it apart, goes back the same way, and finds the same checkpoints kept at the end, or, where
the package drifts, none from the one read on.

## Recordings made in CSBWin

Playing back CSBWin's own recordings needs, beyond the above, the port's random draws to
follow CSBWin's draw for draw, and the recorder's own draws (signatures, `0x2221`)
reproduced. Every line's `random` then points at the first divergence, which makes such a
recording an end-to-end test of the whole port. A recording cannot be written by hand, nor
by a solver such as `tools/solve-3d2d1d.ts`: every line needs its exact tick and random
state.

**The runs that play to their end** (`DEBT.md` F24) are kept in
`tools/fixtures/csbwin-runs/<run>/`, its `playfile.log`, the CSBWin save its first read
reads where it has one, and its readme, and listed in `CSBWIN_RUNS`
(`tools/lib/csbwinRun.ts`): `DMMovie2615` and `DMMovie2823`, two races to fusion, and
`CSBMovie0640`, the race to Fulya Pit, all three recorded by CSBWin 17.6.
`tools/checks/csbwin-runs.ts` plays each to its end.

**A run becomes a recording of the port's** (`recordRun`) by being played into a page
without the DOM through its input boundary, the port's `Recorder` listening, as a player's
page would have changed the game: the port's recording format is kept, and the port's
player plays it. Its start is a new game read from the log's `0x3333` seed, the stream
`ReadEntireGame` begins its draws from (`doc/CSBwin-src/SaveGame.cpp:1605-1645`), or the
run's save. CSBWin's player puts an entry in the queue
at the top of `HandleMouseEvents`, which the port's pass reads before its VBL's tick, so the
game between two VBLs is the game that pass sees, and each entry due is applied there as a
change: a click at its point where the screen has the entry's button there, its key
otherwise, the button-up as the button-up. One entry a pass but after a button-up, as
`HandleMouseEvents` takes them, none while the queue still holds one (a step that waits,
as `PLAYFILE::Backspace` puts it back) or while gravity moves the party; the Reincarnate
screen takes its `0x4444` lines as its keys and its OK. Each entry's random is checked as
CSBWin's player checks it.

**Three line kinds are no input** and change the game: `0x2221` and the signatures, the
recorder's own draws, and `0x2223` and `0x2224`, the save a run's author cut out of it.
Each is recorded as a change of its own, `playfile`, with its button code and its `y`
field (`InputChange`, `src/engine/InputBoundary.ts`), applied as `PLAYFILE::Play` applies
it (`applyPlayfileLine`, `src/engine/PlayfileLine.ts`). The page makes none, and a
package's reader takes only those codes (`PLAYFILE_LINES`).

**A save in the log** is made on the port's save menu, which the log's disk icon opens
as it opens a player's (`diskMenuSave`, `tools/lib/csbwinRun.ts`). The menu takes the log's
two `0xd2`, "SAVE AND PLAY" and the save's file, and at its `0x6668`, which CSBWin
records once the file is written, the save's tail and the menu's close are made
(`saveWritten`, then `tag0207cc`), in `_DisplayDiskMenu`'s order
(`doc/CSBwin-src/SaveGame.cpp:1325-1375`). The recording holds them as a player's save
holds them, and the file itself is not made. "SAVE AND QUIT" and a menu cancelled are
not played yet.

**Where the page differs from CSBWin's playback**, the recording is the page's game: the
frozen game's discard and `lastTime`'s one entry a tick (`Mouse.cpp:1548-1605`), which a
run recorded in play kept to, and `extraTicks`, which playback turns off and the port keeps
on; none of the three runs draws otherwise for either. So the recording takes fewer VBLs
than CSBWin's playback, at the same `d.Time`.

A run's recording is shared as a player's is, packaged at the game's end for a race to
fusion, and at a save made at its log's end for the race to Fulya Pit, on the site's set
whose files are the run's own, whatever its id, by a script the site's owner runs
(`utils/share-csbwin-runs.ts`, `doc/DEPLOYMENT.md` → "Shared recordings").

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
recording against the new build, and one that drifts refuses the deploy: each plays at its
level, so a drift is a change of play made without its flag. A moderator may mark one
broken that no flag mends, made before levels by a build whose play had already changed,
which the list then leaves out but for its uploader and the moderators
(`doc/DEPLOYMENT.md` → "Deploying").

**The browser's points** (`src/engine/RecordingPoints.ts`) are what a player plays and
shares of the store: each save whose recording the store holds up to its point
(`SaveEntry.recording`), and each recording the game's end ended. The book's dialog lists
a set's in its RECORDINGS tab (`src/ui/welcomePage.ts`), but those another passes on its
way (`shownPoints`): a Sleepsave the game went on from, a save F9 read, a save its game's
end followed, each at or before a place the path to a later point goes through, which
plays it whole (`savesOnTheWay`). Of two at one place, the latest made is listed. It lists
them the latest made first, each with what its package would say of it (`pointInfo`);
it plays one by `?recording=`, and deletes a game's end, then
prunes the store
(`pruneRecordings`, `src/engine/RecordingWriter.ts`), which is how one leaves it but by
its set's own deletion.

**The site's recordings** of a published set come first in that tab, as the server lists
them to the player (`siteRecordings`, `GET api/recordings?dataSet=<id>`), by title, the
latest shared first, each marked where an extra was on and with its state to whom the
server tells it: pending, hidden, broken, and "yours" to its uploader. A moderator whose
switch is off is listed them as a player is.

**The panel** of the one selected is a frame of its own under the lists. It says the
recording's title (a browser's point's name), its author and description where it has
them, its party at its point where that is known, the time played, where its path starts,
a new game or a saved one and its level, and where it ends, a save or the game's end,
won or lost; then, of a site's recording, when it was shared and its state, and of a
browser's point, the saves on its way. A browser's point is played and uploaded whole,
or part of it: above its lines, FROM chooses where it starts, its path's own start or a
save on its way, and TO where it ends, the point or a save on its way past the start
(`wayPoints`, `wayEnds`). The saves on the way are the path's own, its row kept or
written over, as a player saves over the same slot and F5 always does: each tail a
recording logged (`saveWritten`), F5's and the disk menu's, and each join of a branch,
which can start a part ("A path cut at a save", above); and a save only its row names,
the Sleepsave's, which can only end one. Each is named by `<recording>:<change>`,
`<branch>:join` or `save:<row>` (`WayPoint.id`), and shown by its play time, its level and
when it was made (`wayLabel`): its row's where the store keeps it, else the tail's, which
the page's saves stamp with them (`SavedStamp`, kept in the store, dropped from a
package); a tail older than the stamp shows its time on the path alone, `≈`. Its lines
then say what the part would: from a saved game and its level where it is known, the
time played since that save, and the saves between (`wayInfo`). UPLOAD to a save whose row
is gone makes its file again, by playing the path to it (`fileAtEnd`), for its package's
MD5. The server reads where a recording ends and its
party from its package as it takes it, and, as it starts, for a row added before it kept
them (`fillEndings`, `server/recordings.ts`). It offers PLAY, `?recording=<id>`, and
`&from=` and `&to=` for a part; to a moderator,
APPROVE on a pending one, HIDE or SHOW on any other, and DELETE, and to its uploader,
WITHDRAW (`POST api/recordings/<id>`). Each delete asks first, and the list is then the
server's anew, a refusal said in the dialog. A local set's book has no site's list. The
set's tile says how many the site lists to everyone, "N replays", which the manifest
counts (`DataSet.recordings`, `RecordingStore.listed`).

**UPLOAD** shares a browser's point, the part FROM and TO chose: its form in the panel
takes a title, which it needs, an author and a description (`RECORDING_TEXT_LIMITS`), then
writes the package and sends it (`uploadPoint`, `POST api/recordings`). From a save on
the way, the path is cut there first in the uploader's browser, and its package, read
back, played to its end before it is sent, the dialog saying how far each has gone; where
it drifts, nothing is sent, and the dialog says why. The viewer waits for nothing; the site's list is then asked anew,
the recording selected in it, pending until a moderator approves it. It is not offered
where the site would refuse it, and the panel says why: a local set, a pending one, or a
path that holds a move of `?dev` (`playedWithDevMoves`).

**The package** (`RecordingPackage`, `src/engine/RecordingPackage.ts`) is one file,
JSON gzipped by `CompressionStream`: the format's version, 3, the build and the level of
the recording shared, its data set, the metadata, the path and the point shared. A package
of another version is refused. The point is a save's (`packageOfSave`): the path the store
holds to the save's recording (`readRecordingPath`), the last recording cut at the save's
point, and the MD5 of the save's file, which the path played to its end makes again, at a
point taken inside a VBL as the Sleepsave's is too (`{kind: 'save', md5, inVbl}`). Or the
game's end (`packageOfEnd`, `{kind: 'end'}`): the path to a recording the end ended, which
its replay reaches. Every recording before the last is cut at the point its child joins
it, so the package holds what the player plays and nothing after it.

A package holds what its replay needs, and nothing the replay makes again (`packaged`).
Each recording of its path holds its `id`, `build`, `level`, `profile`, `files`, `start`,
`rules`, `extras`, `vbls`, `end`, `changes` and `checks`. What the store keeps beside them
is the path's own: the set is the package's, the parent is always the recording before at
its end, and every recording is ended. Its `start` is a new game's stream and playthrough,
`{kind: 'new', seed?, random, randomGameID, totalMoveCount?}`, or a save's file in base64 with what its read left,
`{kind: 'save', bytes, carried}`, for the root alone, and, for a root cut at a save, what
the read lost, `carried.cut` ("A path cut at a save", above), which a package written
before cuts does not hold; a branch's is a join,
`{kind: 'join', md5, carried, inVbl?}`: the MD5 of the file the recorded read read, which
its parent, played to the point, makes again ("The joins", above), and whether that point
was taken inside a VBL. Each change is a row, `[VBLs since the change before, kind,
...arguments]`, its arguments in a fixed order the reader writes out (`changeRow`): a
`click`'s `x, y, buttons`, a `key`'s `num`, a `panelKey`'s `action`, a `reincarnateKey`'s
`key`, a `reincarnateClick`'s `x, y`, a `pause`'s `paused` and its `dialog` where it names
one, an `extras`' extras, a `devLevel`'s `delta`, a `devMove`'s `map, x, y`, a `playfile`'s
`num, y`, and none for the others. Its `checks` are `[change, d.Time, d.RandomNumber]`
for every 64th change and its last (`checkedChange`), the indices increasing, each a
change's. Read, the path is a path of `Recording`s again, as the player plays the store's:
each change keeps its clock and its stream where a check names them, and the player checks
them there alone (`RecordedChange`). The IndexedDB store keeps every recording whole, each
change with its clock and its stream.

The metadata are the player's title, which it needs, author and description, plain text
as long as a set's name, authors and description may be (`RECORDING_TEXT_LIMITS`); when
the path's root began, a cut's when its save was made; when its point was made; the time
played (`Game.playTime`), the game's at its point, and a cut's since its save, its
point's less its save's, which is what its viewer watches; where it starts, a new game or the save's level and champions,
which is read from the root, so it cannot disagree with it; and the party's champions at
its point, the save's (`SaveEntry.champions`) or the game's end's
(`RecordingEntry.champions`), which a package written before it kept them, or of a game's
end the store wrote before, does not say.

The server serves a package `immutable`, under its id, and the page asks for it with the
format's version, `recordings/<id>.gz?v=3` (`recordingPackageUrl`): a browser that holds a
copy of an earlier version under the same id asks anew, and the id, which every link to
the recording names, stays. A package is never rewritten but by a migration of its
format, which keeps its content: `utils/migrate-recording-packages.ts` converts the site's
by a private copy of the old version's reader, before the build that reads the new one is
deployed, plays each to its point, and keeps the old file in the backups
(`doc/DEPLOYMENT.md` → "Shared recordings").

**The server** keeps the packages shared, lists them by set, serves them and moderates
them (`server/recordings.ts`, `doc/DEPLOYMENT.md` → "Shared recordings"). It reads a
package with the page's own reader, bundled for Node (`src/engine/PageReaders.ts`).

`readRecordingPackage` checks a package's form alone, the server's check: it unzips,
to no more than a limit its caller gives, parses, each field has its type (the rules,
the extras and the loop's flags their keys, each change its kind's arguments, a read
none, each check a change's), the texts their limits, the root its start and each branch
its join at its parent's end, and the point its path's end. It does not replay it.

**What a package costs**, measured by `tools/checks/replay.ts --measure`: a new game
played for an hour of its clock at a player's pace, a key or a click in the viewport
every second or so, F5 every three minutes and F9 every nine, shared at a last F5. Its
path is seven recordings and 3,883 changes; its package is 14 KB, 105 KB unzipped, about
3.6 bytes a change. A loaded save costs nothing, its file being its parent's to make, and
neither does the save shared: only a root that starts from a save carries a file, about
42 KB of a 61 KB CSBWin file, which is scrambled, so gzip takes little off it. "Chani vs
the world", four hours of the Amiga's Dungeon Master to its end through eight loads,
53,891 changes, is 143 KB, 1 MB unzipped. So a package's size is its changes, and a save
it starts from.

What sharing takes:

- **Storage**: the store's recordings (above), sent to the server to share.
- **A starting point the viewer has**: a new game of a published data set, or the starting
  save uploaded with the recording. A player's own unpublished set cannot be shared this
  way.
- **The engine's level**, stored with each recording ("A recording's level", above): a
  behaviour change makes older recordings drift unless it keeps the old behaviour behind
  a flag, which their `random` values show at the first wrong entry. A shared recording
  that drifts refuses the deploy, which the replay tool plays them all before
  (`utils/replay-recordings.ts`).
- **Speed**: fast-forward is free, as CSBWin's `#NoSpeedLimit` and `#FastVBLnn`; going
  back means replaying from the start, or from saves taken along the way.
