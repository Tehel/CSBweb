# Achievements and the Hall of Fame

A player earns achievements by what they do in a game: a first kill and the kills after it,
a champion starved, a win eating nothing but apples and corn, a win alone. Each one is
earned in a playthrough (`d.RandomGameID`, `doc/SAVES.md` → "A playthrough"), so the
player knows which game earned it. A data set defines its own achievements in a text file,
beside the ones that every set shares. A player who chooses a public name can show what
they unlocked in the Hall of Fame. The server checks each unlock by replaying the game's
recording, and the `playerId` never leaves the server.

Achievements are not CSBWin's. They are an extra of the site, and they only watch the
game: nothing in a tick changes because a player is earning one ("Watching the engine",
below).

**What exists**: the file format, its reader and its evaluator
(`src/engine/achievements/`), the common file, the tracker that watches the engine
("Watching the engine"), and the page's half: the tracker on a game the player plays, its
history in each save's row, the store of the unlocks, the banner, the dialog and the
welcome page's tab ("The page"); and the players' identities, the public name and its key,
on the server and in the welcome page's PROFILE ("Identity"); and the proofs: a game's
recording sent with the unlocks it claims, replayed by the verifier service, and its
verdicts shown ("Proofs"); and the Hall of Fame, its answers and its page ("The Hall of
Fame"). The rest of this document is the design that `PLAN.md` phase 18
builds, step by step, and each step rewrites its section here to say what was built.

## The file

A set's achievements are `achievements.txt`, an optional file in the set's folder, like
`hcsb.hct` (`ACHIEVEMENTS_FILE`, `src/data/DataSets.ts`), merged with the common
achievements, which every set has, `src/engine/achievements/defs/common.txt`, the one file
the build holds (`achievementDefs`, `src/ui/achievementFiles.ts`). Each reader reads the
set's file where it reads the set's other files: the game's page and the welcome page's
book through the set's files (`readAchievementsText`, `src/data/DataSetFiles.ts`), a
site's set's from its folder and a local set's from its record; the verifier through the
files it replays a proof over (`replayProof`); and the Hall of Fame and PROFILE from the
set's folder on the server (`folderAchievements`, `server/setAchievements.ts`). Each
file's achievements are read once and kept by its text, and the server reads the file
anew at each answer, so an edit of it needs no restart. A set without one has the common
achievements alone. The FTL sets' own achievements are written by the
project, one file per family, beside the repository's manifest: `tools/achievements/dungeon-master.txt`,
which every Dungeon Master set's folder holds, the Atari's, the Amiga's and the hidden
ones, and `csb.txt`, Chaos Strikes Back's. `npm run fetch-gamefiles` copies each into its
sets' folders as `achievements.txt`, and `utils/install-official-sets.ts` copies it to an
instance with a set it installs; a set the instance holds already gets it through a
moderator's edit, as any set's file changes (`PLAN.md` 18.7, step 4). Both give the
common file's values: Speed Runner in less than 180 minutes, Blitz in less than 60, and
Conscientious Objector with at most 40 kills. Dungeon Master's also lists the levels Clean
Sweep counts, 1 to 12, all but the Hall of Champions and the Dragon's, and gives its own
Express Elevator 60 minutes, and has Shining Armour and Darc Knight, the armours of Lyte and
Darc worn whole, Gullible, its bad ending ("Where a game ends"), Every Ending, its three
endings each seen, Grand Slam, both FTL dungeons won, and Hall of Fame Tour, each of its 24
champions in a party that won ("Across games"), Some Assembly Required,
the Power Gem joined to the Firestaff, Pickpocket's Revenge, a Giggler that robbed the
party killed, and Riddle Me This, the riddle room's four riddles answered at once
("Locks and switches"); Chaos Strikes Back
lists no level to sweep, disables Girl Power ("The champions"), and has Self-Reliant, won
without the Hint Oracle asked, Coin-Operated, every GOR COIN lock opened, Fresh Faces,
won with a party raised from the prison alone, and Veterans, from Dungeon Master alone
("Where the party came from"), and Grand Slam, as Dungeon Master's. It has no
achievement for delivering the CORBUMs in time: the fourth delivered to the FULYA PIT is
what wins the game (`doc/CSBwin-src/Attack.cpp:2204`), so its limit would be Speed Runner's
and Blitz's again. A set with no `achievements.txt` of its own reads that file instead. The file is never a game file
(`GAME_FILES`, `src/data/DataSets.ts`), so a recording's digests never name it, and an
author can change the file without breaking a recording.

The file is ASCII text, at most 64 KB. Its first line is exactly

```
# CSBweb achievements 1
```

and the rest is one block per achievement:

```
[first-blood]
name: First Blood
text: Kill your first monster.
tier: easy
when: count(kill) >= 1

[five-a-day]
name: Five a Day
text: Win having eaten nothing but apples and corn.
tier: weird
when: won and ever(eat)
      and never(eat where not item in (APPLE, CORN))
```

- **`#` starts a comment** that runs to the end of the line, except inside a quoted name.
  Blank lines are ignored.
- **`[id]`** opens a block. An id is 1 to 40 lowercase letters, digits and hyphens, and
  starts with a letter or a digit. Once its set is published, an id is permanent: it is what
  each unlock is stored by. The name and the text may change at any time. A block taken out
  of the file hides its achievement and keeps its unlocks.
- **`name:`** is required, at most 32 characters. **`text:`** is required, at most 160
  characters. **`tier:`** is `easy`, `silly`, `weird` or `hard`, and is `easy` when it is
  left out. The tier only sorts and colours achievements; it is worth nothing.
- **`when:`** is the condition, required. It may continue on the lines that follow, each
  of which begins with a space or a tab.
- **`disabled`**, alone in a block, switches off the common achievement of that id in this
  set (a set whose party is always one champion has no use for `solo`). A set's block with
  a common id replaces the common achievement for that set. Disabling an id that the common
  file does not have does nothing, so a published set does not break when the common file
  loses one.
- **`family: name`**, on a line of its own before the first block, at most once, declares
  the family of sets the file's set belongs to, which another dungeon's achievements count
  the games of (`games(…, in "name")`, "Across games"): 1 to 40 lowercase letters, digits,
  dots, hyphens and underscores, a letter or a digit first, the form of a set's id. A set
  whose file declares none, or that has no file, is a family of its own, its id.
  `dungeon-master.txt` declares `family: dungeon-master`; `csb.txt` none, so Chaos Strikes
  Back's family is `csb`. The common file declares none.
- **`value name = number`**, on a line of its own before the first block, defines a named
  value: a whole number from 0 to 1,000,000,000, its name 1 to 40 letters and digits, a
  letter first. A text names it as `{name}`, and a condition where a number would be, as
  `{name}`, or `{name}m` for that many minutes (`h` and `s` too), a duration
  ("Conditions"). **`value name = number, number, …`** defines a list, which a filter
  names for the list of an `in`, `level in {cleanSweepLevels}`. The common file names
  values and defines none; a set's own file defines them:

  ```
  value blitzMinutes = 60

  [blitz]                       # common.txt
  name: Blitz
  text: Win in less than {blitzMinutes} minutes of play.
  when: won and playTime < {blitzMinutes}m
  ```

  A set's achievements are its files merged (`mergeAchievements`): the set's values over
  the common file's, each put in every place that names it. An achievement that names a
  value the set does not define does not exist in that set: no row in the dialog or the
  book, no unlock; nor does one where a list stands in a number's place or in a text. An
  aggregate whose filter names a list is kept by the list it was given, so a set that
  changes its list starts that count afresh in the games saved before. A set without a file of its own, a player's, has none of the valued
  ones. A value the set's file defines that none of its achievements names is reported by
  `unusedValues`, as a misspelt object is by `unknownItems`.

A file with any error is refused as a whole. Each error names its line.

### Conditions

A condition is a yes or a no, made from these parts:

- `and`, `or`, `not`, parentheses, and the comparisons `=`, `!=`, `<`, `<=`, `>`, `>=`
  between two numbers of the same kind.
- **Numbers**: integers, such as `100`, or a named value, `{objectorKills}`.
  **Durations**: `3h`, `90m` and `45s`, or a named value with its unit,
  `{speedRunnerMinutes}m`, which are seconds and compare only with `playTime`.
- **Facts about the game**:
  - `won`, `lost` and `ended` are yes only once the game has ended, won or lost.
  - `gameTime` is the game's clock, `d.Time`, in ticks: about four a second when the party
    is awake.
  - `playTime` is the time the player has played the game, in seconds. It counts the
    VBLs the game has run, sixty a second, so the page and a replay of its recording
    count the same.
- **Counts of the set's data**: `spells`, `foods`, `monsterTypes` and `levels`, numbers
  worked out from the set's own files, the same in every game of the set ("Counted from
  the data").
- **`explored`**: the share of the dungeon's floor squares, its corridors as it begins
  (`floorSquares`, `src/engine/achievements/DataCounts.ts`), that the party has stood on
  at a tick's end, in percent, rounded down. Like a count, it can only be too small in a
  history that starts at a save.
- **Samples**, read at the end of each tick. A sample's bare name is its value at that moment:
  - `party`: the number of champions in the party.
  - `alive`: the number of those champions who are alive.
  - `coins`: the number of coins the party carries, counting the champions' hands, packs,
    pouches and quivers, the chests carried, and the object held under the pointer. A coin
    is any object whose name ends in `COIN`.
  - `party(where filter)`: the number of the party's champions that the filter accepts,
    by what each is at that moment ("The champions", below), such as `party(where feet =
    "BOOTS OF SPEED") >= 4`.
  - `level`, `x` and `y`: where the party stands, its level, from 0, and its square's
    column and row, as the game counts them, north up and `y` growing south. While the
    party changes level in a tick, they are the last tick's ("The tracker").
- **`max(sample)`** and **`min(sample)`** are the largest and the smallest value the sample
  has had in the game.
- **Counts of events**:
  - `count(event)` is how many times the event has happened in the game.
  - `count(event where filter)` counts only the events that the filter accepts.
  - `ever(event [where filter])` means the count is at least 1.
  - `never(event [where filter])` means the count is 0.
  - `distinct(event.attribute [where filter])` is how many different values the attribute
    has had among the events counted.
- **Across games**: `games(condition)`, `total(count(…))` and
  `distinct(games(condition).attribute)`, read over the player's games of the set, and
  `games(condition, in "family")`, over another dungeon's ("Across games", below).

A **filter** is made of `and`, `or`, `not`, parentheses, and these tests on the event's
attributes:

- `attribute = value` and `attribute != value`, and for a number, `<`, `<=`, `>` and `>=`.
- `attribute in (value, …)` and `attribute not in (value, …)`, or `in {name}` and `not in
  {name}` for a list the set's file defines.
- `attribute ~ "pattern"`, where `*` in the pattern stands for any run of characters and
  `?` for one character.

A value is a word, such as `APPLE`, or a quoted name, such as `"DRAGON STEAK"`, or a whole
number for a `level`. Names compare without regard to case.

### The events

| Event | When | Attributes |
| --- | --- | --- |
| `kill` | a monster dies | `monster`, `by`: `melee` `spell` `throw` `explosion` `cloud` `door` `pit` `fusion` `landing`, the party arriving on its group; `item`, the object thrown or swung, `HAND` for a melee blow with an empty hand, or the bomb whose explosion killed; `champion`, who struck; `party`: `yes` when the party's own blow, spell, throw or arrival killed it; `group`, how many of its group the strike has killed, this one included, so 4 is a whole group of four; `thief`: `yes` when its group carries an object it took from the party (`theft`) |
| `hit` | a blow deals a monster damage, a kill or not | as `kill`'s, but `group`; `damage`, what `DamageMonster` takes off |
| `hurt` | a champion takes damage | `champion`; `by`: `monster` `missile` `explosion` `cloud` `door` `pit` `wall` `poison` `starvation` `thirst` `fatigue` `potion`; `party`: `yes` when it came from the party's own missile or spell |
| `death` | a champion dies | `champion`; `cause`, as `hurt`'s `by`: the last damage the champion took; `party`, as that damage's |
| `eat` | a champion eats | `champion`, `item` |
| `drink` | a champion drinks, a potion or water, or from a fountain | `champion`, `item` (`FOUNTAIN` for a fountain) |
| `cast` | a champion casts a spell | `champion`; `spell`, its runes after the power rune, such as `"FUL IR"`; `power`, the power rune: `LO` `UM` `ON` `EE` `PAL` `MON`; `ok`: `yes` when the spell worked; `why`, for a cast the game said failed: `meaningless`, runes that make no spell, `practice`, a skill too low, `flask`, a potion with no empty flask in hand |
| `wear` | an object is put on a worn place | `champion`; `slot`: `head` `neck` `torso` `legs` `feet`; `item` |
| `join` | a champion joins the party | `champion`; `how`: `resurrect` `reincarnate` |
| `revive` | the Vi altar brings a champion of the party back to life | `champion`; `times`, how many times the altar has revived that champion in the game, this one included |
| `raise` | a CSB adventure begins, once for each champion of its party | `champion`; `from`: `prison` `dm` `imported` ("Where the party came from") |
| `enter` | the party stands on a level it did not stand on at the last tick's end, and at a history's first tick | `level`, the map, from 0 |
| `leave` | the party stands on another level than at the last tick's end | `level`, the map left; `cleared`: `yes` when no monster is alive on it then |
| `theft` | a monster's blow takes an object from a champion, a Giggler's | `champion`, `item`, `monster` |
| `swap` | a wall takes the object in hand and gives the hand the one it holds | `item`, the object given; `took`, the object taken |
| `trigger` | an actuator fires: a switch or a lock touched, a pad or an alcove pressed or released, a counter or a combination reaching what it waits for | `level`, `x` and `y`, its square, as the samples count them; `item`, the object that fired it: at a wall the object in hand, `HAND` for none, on a pad or in an alcove the object put or taken, and none for the party, a counter or a combination |
| `sleep` | the party lies down to sleep | none |
| `oracle` | the player asks the Hint Oracle, by its button | none |
| `load` | a save is read, but a CSB adventure's start ("Saves loaded") | none |

An `item` is the object's name as the game shows it (`RN::NameIndex`), from the set's own
`graphics.dat`, or one of the two words no object is, `HAND` and `FOUNTAIN`.
A name that a set's objects do not have matches nothing. The common file names FTL's
objects, so in a set that renamed one of them, that name simply matches nothing. In a set's
own file, such a name is an error, which the set's check reports (`unknownItems`).
A `monster` is named by its type, with CSBWin's own names for the types, `monsterNames`
(`doc/CSBwin-src/Statistics.cpp:16-44`): `Scorpion`, `SlimeDevil`, `Giggler`, `FlyingEye`,
`Hellhound`, `5`, `Screamer`, `RockPile`, `Rive`, `StoneGolem`, `Mummy`, `BlackFlame`,
`Skeleton`, `Couatl`, `Vexirk`, `Worm`, `AntMan`, `Muncher`, `DethKnight`, `Zytaz`,
`WaterElemental`, `Oitu`, `Demon`, `LordChaos`, `Dragon`, `25`, `GreyLord`. No game file
names a monster; CSBWin's statistics name the dead by these, unless the dungeon's `EXPOOL`
names them (`GetMonsterName`, `:48-89`), which the tracker does not read yet. A `champion`
is the name the champion carries. A `spell` is the runes after the power rune, by the
manual's names (`src/core/runes.ts`), which no game file holds either.

### Where a game ends

The samples of where the party stands, read at the game's end, tell an ending the engine
does not tell from a loss. Dungeon Master's bad ending is one: the entrance's pad, map 0
(1,4), sends a party carrying the Firestaff north through (1,3)'s teleporter into the
closed cell of map 0 (9,1), "IT IS TOO BAD YOU DID NOT DISCOVER THE TRUE SECRET OF THE
FIRESTAFF", where a spell launcher kills it. So Gullible is `lost and level = 0 and x = 9
and y = 1`: a game lost in that cell, which nothing else reaches.

### Locks and switches

A `trigger` names the square of the actuator that fired, so a condition names a puzzle by
its squares, as Gullible names its cell. Every actuator that calls `QueueSwitchAction` is
one ("The happenings"), the dungeon's own counters and combinations among them, so a
puzzle the dungeon counts itself is solved where its last actuator fires.

- **Riddle Me This**, Dungeon Master's riddle room on map 5: an alcove holding its answer,
  at (9,17), (12,17), (9,23) or (12,23), counts the two counters of (13,23) down, and the
  answer taken back counts them up. The one at 4 reaches 0 only with the four answers in
  at once, and stays at 0 (`OperateCounterActuator`, `doc/CSBwin-src/Timer.cpp:1603`, a
  counter at 0 no longer moving), and it fires the combination of (13,19), which nothing
  else reaches: `ever(trigger where level = 5 and x = 13 and y = 19)`. Every Dungeon
  Master set has the same room.
- **Coin-Operated**, Chaos Strikes Back's GOR COIN locks: nine walls' sides of type 4
  taking a GOR COIN, on map 0 (9,14), (21,16) and both sides of (22,19), map 3 (2,12),
  and map 4 (21,11), (24,11), (26,18) and (19,19). Each fires once but (2,12) and map 4's
  (19,19), which take a coin each time, so the condition asks for each square, and for
  two at (22,19). An `item` alone names no lock: a switch touched with a coin in hand is
  a trigger with that coin too.

### Where the party came from

A CSB adventure's party is put in by a utility from a saved game (`doc/SAVES.md` → "RISE
makes a save of its own"): the prison's, whose champions are Chaos Strikes Back's own, or
another dungeon's, Dungeon Master's most often. As the tracker begins the adventure's
history ("A CSB adventure") it raises each champion of the party, `from: prison` where
their portrait is a cell of the set's own champions' portraits, graphic 26 of its
`graphics.dat`, the faces its mirrors give; `from: dm` where it is a cell of either sheet
of the set's `utility-portraits.dat` (`dungeonMasterFaces`,
`src/data/UtilityPortraits.ts`), Dungeon Master's graphic 26 and the utility disk's
redrawn faces of the same 24, so a DM party raised with OLD FACE or NEW FACE is from DM;
and `imported` otherwise, which is every champion of a set without that file. A champion
is known by their portrait, as RISE's NEW FACE knows them, and never by their name, which
REINCARNATE changes and the portrait keeps. Chaos Strikes Back's 24 portraits are none of
Dungeon Master's, nor of the utility disk's. No game holds whether the DM game the party
came from was won: a DM save is always made before the win, which writes none, and the
adventure keeps only the party of its source (`TAG002724`, `src/engine/Chaos.ts`).

- **Fresh Faces**, Chaos Strikes Back's: `won and ever(raise) and never(raise where from !=
  prison)`. A game that begins at another save raises nobody, so only a whole history
  can earn it.
- **Veterans**, Chaos Strikes Back's: `won and ever(raise) and never(raise where from !=
  dm)`, a party of Dungeon Master's champions, however many, and only theirs.

### Saves loaded

Every save read is a `load`, in the history the read takes up: the save menu's and the
entrance's, F9's, the save chooser after the party died, and the page's CONTINUE after it
was closed. CONTINUE is no different: the recording's path prunes what was played past a
save before its read (`doc/RECORDING.md` → "Pruning"), so neither the history nor the
verifier's replay can tell a game resumed from a save reloaded after a death. A CSB
adventure's start is no load: it raises the party and begins the game ("A CSB
adventure"). So a game won with no `load` was played in one sitting from its start, a path
with no join, which the verifier replays exactly. There is no SAVE AND QUIT to leave a
game and come back without one (`doc/SAVES.md` → "What the dialog leaves out").

- **Ironman**: `won and never(load)`.
- **Hardcore**: `won and never(load) and never(death)`.

### The champions

`party(where …)` filters the party's champions at a tick's end, each by these attributes
(`CHAMPION_ATTRIBUTES`, `src/engine/achievements/AchievementFile.ts`). A champion who is
only a candidate at a mirror is not in the party.

| Attribute | What it is |
| --- | --- |
| `champion` | the name the champion carries |
| `sex` | `male` where the champion carries `CHARFLAG_male`, which `AddCharacter` sets from the champion's text (`doc/CSBwin-src/Character.cpp:595`), else `female` |
| `alive` | `yes` or `no` |
| `head`, `neck`, `torso`, `legs`, `feet` | the object worn there, its name as an event's `item` is |
| `ready`, `action` | the object in the ready hand, possession slot 0, and in the action hand, 1 |
| `fighter`, `ninja`, `priest`, `wizard` | the rank in the class, a number |
| `load` | what the champion carries, in percent of the most they can, rounded up |
| `portrait` | the number of the cell of the set's champions' sheet, graphic 26, the champion's portrait is, from 0, the first of two the same; none where it is no cell, a champion a utility put in from another dungeon |

A **rank** is the class's mastery as the credits show it, `DetermineMastery(chIdx, skill |
0xc000)` (`doc/CSBwin-src/Code17818.cpp:13`): the experience alone, with no object's bonus,
such as the Firestaff's, and no temporary adjustment, and the champion's own while the party
sleeps, when `DetermineMastery` reports 1 for every skill. It is that mastery less one, and
no more than 15, ARCHMASTER, which the inventory shows for every mastery from 16 up
(`d.Pointer16770`, `doc/CSBwin-src/CSBCode.cpp:380-394`):

| Rank | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 to 14 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shown | nothing | NEOPHYTE | NOVICE | APPRENTICE | JOURNEYMAN | CRAFTSMAN | ARTISAN | ADEPT | EXPERT | LO to MON MASTER | ARCHMASTER |

The **load** is `CHARDESC.load`, the object in hand weighing on its owner, against `MaxLoad`
(`doc/CSBwin-src/Code11f52.cpp:4318`), the most the inventory shows the champion can carry,
which falls with the stamina and a wound. Rounded up, `load > 50` is exactly more than half.

The **portrait** is read from the champion's own pixels, `CHARDESC.portrait`, which a
save's champion holds, and is the cell whose pixels they are; a champion who joined at a
mirror since the last read holds the `charID` `AddCharacter` blitted the cell from instead
(`doc/CSBwin-src/Character.cpp:487-509`), and is that cell. REINCARNATE keeps it under a
new name, so a champion is known by it as RISE's NEW FACE knows them.

**The sex is not to be trusted in a CSB adventure CSBWin's utility made.** That utility
clears `CHARFLAG_male` from every champion it carries over (`DEBT.md` H, "A champion
carried into a new adventure keeps their sex"), so such a party reads as no man; RISE's
adventure keeps the flag. Girl Power, `won and max(party(where sex = male)) = 0`, reads the
flag, which is right in Dungeon Master, where every champion joins at a mirror, and
`csb.txt` disables it, so that no CSB game, RISE's adventures included, earns it by a flag
lost.

### Counted from the data

Four numbers a condition reads are the set's own, so that one condition says "every one
of them" in every set:

```
[gourmet]
name: Gourmet
text: Eat every kind of food the dungeon holds.
when: foods > 0 and distinct(eat.item) >= foods
```

- **`spells`**: the spells of the set's table (`d.Spells`, graphic `0x230` of its
  `graphics.dat`), each once by the runes after the power rune, which `cast.spell` names.
- **`monsterTypes`**: the types of the groups the set's dungeons place, those a group
  carries among them, and of the monsters their generators make (an actuator of type 6 on
  an open square, `doc/CSBwin-src/Timer.cpp:1771-1820`, the type its value's low five
  bits, `doc/CSBwin-src/Monster.cpp:130`), less the types a blow cannot kill (their
  `MonsterDesc`'s invincible bit): Lord Chaos, whom only the Firestaff fuses, type 25
  and the Grey Lord. Bestiary leaves out the fusion's kill for the same reason.
- **`foods`**: the kinds of food, the objects `_FeedCharacter` chews (`APPLE` to `DRAGON
  STEAK`), among the objects the set's dungeons hold, on a square, carried by a group or in
  a chest, and among the droppings of those monster types (`CreateAndDropObject`,
  `doc/CSBwin-src/Code11f52.cpp:735-788`), such as a worm's worm rounds.
- **`levels`**: the maps of the dungeon the game is played in that hold a floor square, a
  corridor, which `enter.level` names. Chaos Strikes Back's adventure has eleven maps, and
  the last is a single square of stone.

A set's dungeons are its `dungeon.dat`, and its `mini.dat` where it has one, Chaos Strikes
Back's adventure, which is the dungeon its game is played in. Dungeon Master counts 25
spells, 8 foods, 24 types and 14 levels; Chaos Strikes Back 25 spells, 8 foods, 23 types,
three of them only its generators make, and 10 levels (`tools/checks/achievements-format.ts`).
Every Dungeon Master set has the same 14 levels, so `dungeon-master.txt` names the deepest, 13.

Each count is that of the values its event can take in a game of the set, so `distinct(…)
>= count` is exact: a spell that works is one of the table's, a meal one of the foods, a
monster a blow kills one of the types, a level the party stands on one with a floor. A dungeon whose DSAs create a monster or a food of
a kind the counts leave out, or make something else edible, can reach the count with it
instead. A set whose count is 0 has nothing to earn, so the common file's conditions ask
for more than 0 first.

The tracker works the counts out as it is made (`dataCounts`,
`src/engine/achievements/DataCounts.ts`), from the game's tables and the set's dungeon
files, and puts them in the conditions (`withCounts`). The welcome page and the Hall of
Fame list a set's achievements without its files, so a text cannot name a count as it
names a value: Gourmet says "every kind of food", not "the 8 kinds".

### Across games

An achievement across games reads the player's games of the set, each playthrough
(`d.RandomGameID`, `doc/SAVES.md` → "A playthrough") one game, through three numbers:

- **`games(condition)`**: how many playthroughs met `condition`, a condition of one game,
  at any point of their history, as an achievement unlocks. `games(won) >= 3` is Encore.
- **`total(count(event [where filter]))`**: the sum of each playthrough's count.
  `total(count(kill where party = yes)) >= 500` is Dungeon Janitor, and 1000 Lord Chaos's
  HR Problem, the kill ladder's top rungs: the dungeon holds a few hundred monsters, DM
  303 and CSB 266, generators aside.
- **`distinct(games(condition).attribute)`**: how many values an attribute of the
  champions ("The champions") had among the parties of the playthroughs as each met
  `condition`, the dead champions among them, a champion with no value not counted.
  `distinct(games(won).portrait) >= 24` is Hall of Fame Tour.

Such a condition reads nothing else of a game: no fact, sample or count outside them, and
no `games(…)`, `total(…)` or `distinct(games(…)…)` inside a `games(…)`. It only asks for "at least": a
game left out, its figures lost or touched by a teleport, can only make a number too small,
so `games(won) = 0` or `total(…) < 10` is refused. It needs no game's whole history; the
condition inside `games(…)` does where its form says so ("Some conditions need the whole
game"), as an achievement's.

Each `games(…)` condition is tested in every game as an achievement is, kept by its key,
its canonical text (`games(won)`), and never unlocked as one. As one is met, each
`distinct(games(…).attribute)` of it keeps the values of the party's champions at the last
tick's end, kept beside a save as a `distinct`'s values are. Each history's **figures**
(`GameFigures`, `AchievementState.figures`) are 1 for each `games(…)` it met, each
`total(…)`'s count, and 1 for each value a `distinct(games(…).attribute)` kept, a figure
of its own (`partyFigureKey`, `distinct(games(won).portrait)="7"`), so the page's rows and
the proofs' figures keep them as they keep a number. A playthrough's figures are each the
largest any of its branches reached, never their sum: two branches share their history up
to the save they part at, and two branches won by two parties keep both.
`acrossUnlocked` (`src/engine/achievements/AchievementState.ts`) tests a set's achievements
across games over the playthroughs' figures.

- **Encore** (common): win the dungeon three times, in three games.
- **Every Ending**, Dungeon Master's: `games(won) >= 1`, its bad ending, `games(lost and
  level = 0 and x = 9 and y = 1) >= 1`, as Gullible's ("Where a game ends"), and a loss
  anywhere else, `games(lost and not (…)) >= 1`.
- **Hall of Fame Tour**, Dungeon Master's: `distinct(games(won).portrait) >= 24`, each of
  the Hall's 24 champions in a party that won, over any number of games, by their portrait,
  so a champion renamed by REINCARNATE is the same and one dead at the win counts.

A total is of one set's games: a Dungeon Master won on the Atari 1.1 and one on the Amiga
are two sets' wins.

**Another dungeon's games**: `games(condition, in "family")` counts the playthroughs that
met `condition` in every set of that family, this set among them where it is one of them:
each set whose own file declares it (`family:`, "The file"), and the set whose id it is
where its file declares none (`familyOf`, `src/engine/achievements/PageAchievements.ts`).
`"dungeon-master"` is every Dungeon Master set, the Atari's, the Amiga's and the hidden
ones, and `"csb"` Chaos Strikes Back. Any set may declare a family, a player's among them,
and its games then count as that family's. The figure it reads is the one each of those
sets keeps by the same key, `games(won)`, so a set counts there only by a condition its own
achievements test; an achievement that names another family's games is best in both
dungeons' files. `acrossInSets`
(`src/engine/achievements/PageAchievements.ts`) tests a set's achievements across games
over each set's playthroughs' figures, for the page, the book and the Hall alike.

- **Grand Slam**, Dungeon Master's and Chaos Strikes Back's, the same block in both:
  `games(won, in "dungeon-master") >= 1 and games(won, in "csb") >= 1`. It unlocks in both
  dungeons' lists once each is won, a Dungeon Master won on any of its sets.

**On the server** an achievement across games is claimed by no proof: each replay keeps its
history's figures (`proof_figures`, "Proofs"), and the Hall works the achievements out of
an identity's checked proofs ("The Hall of Fame"). A Dungeon Janitor or an HR Problem a
replay verified in one game, before they moved across games, stays verified.

### When an achievement unlocks

The conditions are tested at the end of each tick that changed anything they read, and at
the game's end. An achievement unlocks the first time its condition is yes, and stays
unlocked.

**Some conditions need the whole game.** A game read from a save that holds no history of
its own, such as an imported CSBWin save, has a history that starts at that save. Its
counts, its `max` and its `playTime` are then only lower bounds: they can only be too
small. Its `min` can only be too large. A condition that could be yes because one of these
is wrong, such as `never(…)`, `count(…) = 0`, `max(party) = 1`, `distinct(…) <= 3` or
`playTime < 3h`, **needs the whole game**. Such a condition is tested only in a game whose
history goes back to its start. The reader decides this from the condition's form
(`needsWholeGame`), so an author never has to mark it. A condition that only asks for
"at least", such as `count(kill) >= 100`, can be earned in any game.

**A CSB adventure** is a game from its start. Chaos Strikes Back's adventure begins at a
save that a utility makes, RISE's or CSBWin's UTILITY's, `mini.dat` with a party put in
(`makeNewAdventure`, `src/engine/Chaos.ts`): the prison before it is only where the party
is chosen, and its kills and meals are few. Such a save holds no history, but its history
is the whole game's all the same, so every common achievement is CSB's too. The tracker
tells it by its bytes alone (`isNewAdventure`): the fields the utility writes taken from
the file into the set's `mini.dat`, which the utility's writer writes, give the file back
byte for byte. So the page and the verifier agree, and a CSBWin adventure imported counts
as RISE's does.

## Watching the engine

The engine tells its host what happened through one `GameHost` member,
`observe(happening)` (`src/engine/Happening.ts`). Like `trace` and `tracing`, it comes
with a flag, `observing`, tested before a happening is built, so nothing is built when
nobody listens. A call changes no state, draws no random number and changes no path
through the code, so it changes nothing in a tick and needs no `ENGINE_LEVEL`
(`doc/RECORDING.md` → "The policy"). `tools/checks/achievements-tracker.ts` plays the
whole replay corpus with the tracker attached, and every package plays to its point.

### The happenings

- **A blow** is told around the call that deals it: `blow`, with its cause, then
  `blow-end`. What dies or is hurt inside is the blow's. Blows nest, and one that names no
  side of its own takes the side of the blow around it. The blows are where
  `damageMonster`, `damageMonsterGroup`, `damageCharacter` and `damageAllCharacters` are
  called: a melee blow (`AttackSystem`, the weapon in the action hand), a missile meeting
  a monster or a champion and its explosion (`MissileEncounter`), the blast of a fireball
  or a lightning bolt as its cloud appears (`createCloud`), a poison or dispel cloud's
  tick (`TimerSystem`'s `TT_25`), a door closing (`TT_DOOR`), a pit (`WorldMove`), a wall
  run into (`MovementSystem`), a monster's blow (`MonsterAttack`), poison
  (`poisonCharacter`), a potion that takes health off (`applyFeedParameters`), the party
  landing on a group (`WorldMove`), and Lord Chaos fused (`_FusionSequence`, his type as the sequence finds him: it flips it to the
  mon_25 graphic and back before the Grey Lord).
- **The stamina's damage** (`adjustStamina`) is starvation while the champion's food is
  below −512, else thirst while the water is, else fatigue: the thresholds below which
  `TenSecondUpdate` takes stamina for them (`doc/CSBwin-src/Code17818.cpp:289`, `:313`).
- **A monster is hit** where `DamageMonster` takes a positive damage off a member a blow
  can hurt, not an invincible type's nor an invulnerable member's: the damage it was given,
  whether the member survives it or not.
- **A monster dies** where `DamageMonster` finds a member's death, whether the group is
  removed then or by the move it was hurt in (`apply` false): once a member. A member at
  0 HP that `ProcessTimers29to41` removes (`MonsterAI`) dies inside no blow, and is
  nobody's kill. The group the party lands on, which `MoveObject` deletes where the party
  arrives (`doc/CSBwin-src/Code11f52.cpp:3333-3343`, `WorldMove.moveParty`), dies whole in a
  blow of the party's, `landing`: a death each member. `DeleteMonster` and
  `DeleteMonsterInGroup` alone kill nobody else: the monsters Fusion clears from the
  level, a DSA's, a full database's.
- **A strike** is an outermost blow, with the blows after it in the same tick of the
  same missile: a missile's meeting with a group and its explosion, whose blast is a blow
  inside it, are one strike, a fireball's. A kill's `group` counts the members of its
  group, by the square it stands on, that the strike has killed; a kill outside any blow
  is 1.
- **A champion is hurt** where `DamageCharacter` adds to the pending damage, and **dies**
  at `KillCharacter`. The damage is pending till the tick's `DisplayCharacterDamage`, so
  the tracker keeps each champion's last cause and whether it was the party's, and a
  death outside any blow takes both.
- **The meals** are at `handleMouthPress`: a meal chewed is eaten, a waterskin's or a
  potion drunk. Drinking at a fountain (an extra) is `FOUNTAIN`. The stand-in page runs
  that code in a replay too.
- **The spells** are at `CastMagic`, around `castSpell`: the runes it reads, the
  champion's or a spell filter's, whether it returned 1, and the code of the message
  `SpellErrorMsg` printed in it, if any (`doc/CSBwin-src/Magic.cpp:1007`): 1 a meaningless
  spell, 0 more practice needed, 10 no empty flask. A failure it prints nothing for, a
  spell filter's abort or a dead caster's, has no `why`. A DSA's `&CAST` and a weapon's
  spell are not the player's cast.
- **A worn object** is at `AddCharacterPossession` into the head, the torso, the legs or
  the feet (slots 2 to 5) or the neck (10), the slots whose `CarryLocation` is those
  places' masks (`doc/CSBwin-src/CSB.h:1682-1687`, which the check reads in
  `graphics.dat`). A mirror's champion's own possessions are not put on by the player.
- **A join** is at the end of `_ResurrectReincarnateCancel`, beside
  `GameHost.championJoined`.
- **The Oracle asked** is at its button, as `ui.hintOracleNeeded` is raised
  (`src/renderer/ui/Mouse.ts`, `doc/CSBWIN_HINT_ORACLE_REFERENCE.md`), which the live page
  and a recording played back both run: the page then opens the Oracle, the playback
  stops the clock for it. A click refused, with an empty party or a champion only
  provisionally joined, asks nothing.
- **A theft** is at `StealFromCharacter` (`doc/CSBwin-src/Monster.cpp:239`), the blow of a
  monster whose attack steals, a Giggler's (`monsterShouldSteal`, `:1083-1084`): one for each
  object it takes from the champion into its group's possessions. A group carries what it
  took until its last member dies and drops it (`DropMonsterRemains`,
  `doc/CSBwin-src/Code11f52.cpp:865`), so a kill is the
  thief's, `thief: yes`, where its group carries one of the objects taken: each member of
  the thieves' group, and none of another's. The tracker keeps those objects by RN, which
  an object keeps wherever it is moved; `monster-died` names the group's first possession,
  the record linking the rest.
- **A swap** is at an actuator of type 16 (`doc/CSBwin-src/Mouse.cpp:473-512`), as the
  object in hand is put on the wall's square and the one there is given to the hand. The
  only one in Dungeon Master is the wall of map 13 (24,3), which swaps THE FIRESTAFF for
  THE FIRESTAFF, the one with the Power Gem; Chaos Strikes Back has none.
- **A trigger** is at each actuator that calls `QueueSwitchAction`
  (`doc/CSBwin-src/Code11f52.cpp:3601`): `TouchWall` (`doc/CSBwin-src/Mouse.cpp:291`) as a
  wall's switch fires, before a lock takes the key; `PressurePadOrAlcove`
  (`doc/CSBwin-src/Code11f52.cpp:3720`) as a pad or an alcove fires, on the object put or
  taken, or the party's move; and `ProcessTT_STONEROOM` (`doc/CSBwin-src/Timer.cpp:2165`),
  as a counter or a combination a message reached sends its own. Each names the actuator's
  square, where a counter hands `QueueSwitchAction` its target instead
  (`doc/CSBwin-src/Timer.cpp:1610-1612`). A pad held down, a counter or a combination
  that sends at every message (the action `hold`) is a trigger at each, so a game counts
  many: the whole CSB game over a hundred thousand.
- **A sleep** is at the sleep icon's engine half, button 145 (`MouseSystem.sleep`,
  `doc/CSBwin-src/Mouse.cpp:1822-1847`), as `d.PartySleeping` is set: a party woken in the
  same tick has slept all the same.
- **A revival** is at `ProcessTT_ViAltar`'s last state, as `BringCharacterToLife` brings
  the champion back (`doc/CSBwin-src/Timer.cpp:2806-2808`), its only caller: the bones
  given to the altar's alcove, five ticks of its cloud, then the bones taken. A champion
  who has left the party is revived in the wings instead (`:2771-2782`), outside the party,
  and is no revival.
- **Where the party is** needs no happening: the tracker reads it at each tick's end, and
  where the party came from at a CSB adventure's start.
- **The game's boundaries**: each VBL of the player's time (`Game.playTime`'s), each main
  loop tick's end, `MainLoop`'s return (won or lost), a new game read, a save's file made
  (`saveFileOf`) and a save's file read (`applySaveBytes`).

### A missile's owner

CSBWin records nobody as a missile's launcher. `LaunchMissile` (`doc/CSBwin-src/Magic.cpp:17`)
is the only place a missile is made: it takes a `DB14` record (`:33`), which holds the
object flying, its range and damage left, and its timer (`:37-39`, `:72`,
`doc/CSBwin-src/CSB.h:1301-1321`), and nothing else. The party launches through
`ThrowByCharacter` (`doc/CSBwin-src/Mouse.cpp:744`), reached from the hand and from the
THROW attack (`doc/CSBwin-src/Attack.cpp:2107`), and through `LaunchObject`
(`doc/CSBwin-src/Magic.cpp:452-466`), reached from `CharacterThrowsSpell` (`:473`), that is
a spell cast (`:1281`) or a weapon's spell attack (`doc/CSBwin-src/Attack.cpp:1329`), and
from SHOOT (`:1908`). Monsters (`doc/CSBwin-src/Monster.cpp:1198`), wall shooters
(`doc/CSBwin-src/Timer.cpp:1985`, `:1997`) and a DSA's throw (`:2067`) launch the rest.

So the port's `launchMissile` takes the launching champion, given only by those two party
paths, and tells it with the missile's RN. The RN is the missile's while it flies: a
teleporter turns it and keeps it (`doc/CSBwin-src/Code11f52.cpp:3029`, `:2427`), a pit
does not take it (`:3043-3046`), and stairs stop it (`:3147`). It is freed when the missile
ends (`ProcessObjectFromMissile`, `doc/CSBwin-src/Timer.cpp:165`), or by `MakeMoreRoomInDB`
(`doc/CSBwin-src/Character.cpp:292-301`), and `FindEmptyDBEntry`
(`doc/CSBwin-src/data.cpp:921`) may give it at once to any other record. The tracker tags it
at each launch, which overwrites what an earlier record of that RN left.

Every meeting goes through `ProcessMissileEncounter`
(`doc/CSBwin-src/Code11f52.cpp:1746`), which has the missile's RN and its object in hand
where it calls `DamageMonster` (`:2051`) and `DamageCharacter` (`:2081`), and where it makes
the explosion, `CreateCloud` (`:2134`), before the record is deleted (`:2169`). `CreateCloud`
(`:1411`) makes a `DB15` record that holds only the spell's type and size (`CSB.h:1333`),
and deals a fireball's or a lightning bolt's blast itself (`:1526`, `:1544`), with no
missile in hand. A poison cloud hurts on each of its ticks (`ProcessTT_25`,
`doc/CSBwin-src/Timer.cpp:572`, `:580`). So the explosion is a blow inside the missile's,
the cloud made there takes the missile's side when it is told, and its blast and its ticks
are blows of the cloud's. That is what `party: yes` means: the party's own throw, cast or
shot, or the explosion or cloud it made. A missile or cloud in flight when a save is made
keeps its side in the tracker's state kept with it.

### The tracker

`AchievementTracker` (`src/engine/achievements/AchievementTracker.ts`) turns the
happenings into the evaluator's events and samples (`AchievementState`). It is a function of
what it observes, and of nothing else, so a live game and its replay give the same unlocks.
It reads the game only to name things: a champion, an object, the samples. It is made
with the set's dungeon files (`AchievementSetFiles`): it reads the counts of the data from
them and the game's tables ("Counted from the data"), and a CSB adventure's start against
the `mini.dat`, its party against the set's graphic 26 and its `utility-portraits.dat`
("Where the party came from").

- At each tick's end it takes the samples: `party` and `alive` leave out a mirror's
  champion; `coins` counts every object whose name ends in `COIN` in the party's
  possessions, inside the chests they carry (an open chest's slots for the open one) and
  under the pointer. Where a condition reads `party(where …)`, it reads each champion's
  attributes ("The champions"). It reads where the party stands, the samples `level`, `x`
  and `y`: a level other than the last tick's
  is `leave` of that one, then `enter` of this one, and a floor square not stood on yet
  adds to `explored`. A party moved to another level in the tick's input stands there from
  the next tick, which loads the level (`Game.loadNewPartyLevel`, `d.newPartyLevel`):
  until then its square is the new level's and its level the old one, so the tracker
  reads nothing of its place. A level left is `cleared` when no group is on one of its
  squares, nor waits to be put on one on a `TT_60` or `TT_61` timer
  (`CreateMovementTimer`, `doc/CSBwin-src/Code11f52.cpp:2481`). It sets the clock, adds the
  VBLs counted, and tests the conditions. At `MainLoop`'s return it does the same and says
  the game ended.
- It keeps its state by the MD5 of each save's file it sees made, and when a file is read
  it takes up the state kept for it, the level the party stood on, the floor squares
  walked on, the objects taken from the party and each champion's revivals among it: a replay's joins read the files their parents made, so each branch
  goes on with its parent's history. A file read with no state kept starts a
  history of its own ("Some conditions need the whole game"), unless it is a CSB
  adventure's start, read against the set's `mini.dat` ("A CSB adventure"), which starts
  one from its start, as a new game does. Every read but that start records a `load`
  ("Saves loaded").
- `snapshot` and `keep` give the page the state to store beside a save and to give back
  at a read ("The page").

`tools/checks/achievements-tracker.ts` proves it on the corpus: each join reads its
parent's state, a path from a new game or a CSB adventure's start keeps its whole history
and one from another CSBWin save does not (the whole CSB game, which begins at the
adventure CSBWin's utility made, unlocks Speed Runner), and the kills, the deaths and
their causes, the joins, the meals, the worn objects and the unlocks of Dungeon Master won
(DMMovie2615), a lost game and the whole CSB game, each tracked with its set's
achievements: DMMovie2615's Ful bombs (Grenadier), its champion lost to a wall (Stubbed
Toe) and its win with one of four alive (Sole Survivor); and that the tracker counts its
set's data, Rune Scholar, Gourmet and Bestiary unlocking exactly where a game's distinct
spells, foods and types reach the counts: the whole CSB game eats all eight foods; and
where the party is: each history enters a level and leaves it before the next, a join's
read and a state kept and read back take up the level and the floor walked, Tourist
unlocks where the levels entered reach the set's, DMMovie2615 leaves the Hall of Champions
cleared and the Dragon's level not, and reaches level 13 within the hour, Deep Diver and
Express Elevator at the tick it enters. The games played to their end explore well under
90% of the floor: 37 to 39% for Dungeon Master's wins, 65% for the whole CSB game. And the
champions: Leyla a woman and Halk not, the feet counting Stamm's boots of speed from the
first tick's end after he puts them on, the first Master and the first load over half at
the tick the tool reads them itself, and Low Profile, Archmaster, Jack of All Trades,
Featherweight and Insomniac as the games' ranks, loads and sleeps say: DMMovie2615 wins
with no champion above Journeyman, so Low Profile, and sleeps nine times; the whole CSB
game's party reads as no man, CSBWin's utility having cleared the flag. And the blows: a
hit for each `DamageMonster` call that hurt or killed, its damage the call's, a kill's
`group` one more than the kill before it in its strike, a melee kill naming `HAND` exactly
where the action hand was empty, and a death the party's exactly where the champion's last
hurt was. Dungeon Master's wins deal blows of 140 and 173 (Overkill), and DMMovie2615's
fireballs wipe out two groups of four (Strike!). No recording lands on a group nor loses a
champion to the party, so the tool puts a new game's party on a group of four mummies,
four kills by landing (Telefrag), and lets a champion its explosion hurt die after a save
kept and read back (Friendly Fire Fatality). And where a game ends: the whole CSB game,
which never asks the Oracle, is Self-Reliant, and a new game's champion carrying the
Firestaff north from the entrance's pad dies in map 0 (9,1), the game lost (Gullible);
`tools/checks/hint-oracle-button.ts` proves each click on the Oracle's button tells one
`oracle`, and a refused one none. And the objects swapped and taken: the Dungeon Master
wins join the Power Gem, Some Assembly Required unlocking at the tick the Firestaff with
the gem is first in hand; a theft for each object a Giggler's blow takes, DMMovie2823's
seven and three of its thieves killed (Pickpocket's Revenge), and a new game's Giggler
that robbed nobody no thief, those whose group took a torch thieves, across a save kept
and read back. And the locks and switches: a trigger with a GOR COIN at a wall for each
coin the wall took from the hand, Riddle Me This the tick after the riddle room's counter
at 4 reaches 0, which the Dungeon Master wins do and DMMovie42, three riddles answered,
does not, and the whole CSB game feeding all nine GOR COIN locks (Coin-Operated). And the
revivals and the party raised: a revival for each champion `BringCharacterToLife` brings
back, DMMovie2823's one; no recording revives one champion three times, so a new game's
two champions die and their bones are given to the altar's timer, the first's three
times, Lazarus unlocking at the third, after a save kept and read back; and the whole CSB
game's four prisoners raised from the prison (Fresh Faces), where `csbgame7.dat`'s four DM
champions, raised by RISE with their own faces or the utility disk's, are from DM, and
imported where the set has no utility portraits. And the saves loaded: a load for each
read but a CSB adventure's start, each join's among them, DMMovie2615 Ironman with a
champion lost, and the whole CSB game Ironman and Hardcore.
`tools/checks/achievements-format.ts` reads each file, checks its names against its set's
`graphics.dat` and its values against its achievements, counts the FTL sets' data, and
plays the conditions out of made-up events and champions, the named values, the lists and
the counts put in their places, and the achievements across games: what the reader refuses
of them, each game's figures, and Encore, Every Ending, Dungeon Janitor and HR Problem over
made-up games' figures, and Grand Slam over made-up sets' games.

## The page

The page tracks the achievements of a game the player plays (`PageAchievements`,
`src/engine/achievements/PageAchievements.ts`), and of no other.

- **Its achievements** are the common file's merged with the set's own file, where it
  has one (`achievementDefs`, its text read through the set's files by `src/main.ts`, past
  the digests a recording keeps). A file that does not read leaves the game without
  achievements, and the console says why.
  The objects are named by the screen's `objectTables`.
- **The recording's viewer** (`?recording=`) builds no tracker, and nothing observes its
  engine: a recording played back is no game of the player's.
- **A teleport earns nothing.** A playthrough that `?dev`'s teleport has moved, by the map
  dialog or by the level keys, is kept in `localStorage` (`keptTeleportedPlaythroughs`,
  `src/ui/gameEvents.ts`) and sends no statistics; the same list refuses its unlocks: the
  tracker goes on, but nothing is stored or shown.
- **The history is kept in the save's row.** Each save that `GameSaves` writes (the disk
  menu's SAVE, F5, the Sleepsave, and the quick-save that begins CSB's adventure) stores
  in its row the tracker's state as the file was made (`SaveEntry.achievements`). Each
  read (LOAD, F9, CONTINUE at the boot) hands the row's state to the tracker under the
  file's MD5 before the file is read (`AchievementTracker.keep`), so the game goes on
  with the save's history: what was unlocked after the save is forgotten, and unlocks
  again if it is earned again. A row with none (an import, a row made before rows held
  one) starts a history of its own, which is not the whole game's, unless its file is a
  CSB adventure's start, as a new adventure made by RISE is ("A CSB adventure"). The history is the store's alone: an export carries the CSBWin file and nothing
  else, and CSBWin reads every export (`doc/SAVES.md`).
- **The `achievements` store** in the saves' IndexedDB database (version 9,
  `BrowserAchievementStore`) keeps one row per set, achievement id and playthrough
  (`AchievementRow`): when it was unlocked, the player's time then (the tracker's VBLs),
  the game's clock, the party's names, and how far its proof has got, `unverified`,
  `verified` or `dropped`, with the proofs that claim it ("Proofs"). A row is written as the tracker unlocks, unless
  one of the same key is there: the first unlock stays when a branch loaded since unlocks
  it again.
- **The `achievementFigures` store**, beside it, keeps one row per set and playthrough
  (`AchievementFiguresRow`): its figures, each key at the largest its branches reached
  (`raiseFigures`, one transaction). After each test of the conditions
  (`AchievementTracker.onTested`), the page raises the playing playthrough's row where its
  history passed it, and tests the set's achievements across games over every row of the
  set, and of the other sets as they were when the game began ("Across games"). One their
  figures make yes is unlocked once, in whichever playthrough:
  a row of the playthrough playing, shown as any other, which the dialog counts unlocked
  in every game of the set. A playthrough a teleport has touched writes no figures.

- **The banner** (`src/renderer/ui/AchievementBanner.ts`): an unlock shows ACHIEVEMENT
  UNLOCKED, its tier and its name on a panel across the top of the viewport, drawn after
  the game and under any dialog, never in the message area, which is the engine's. It
  stays three seconds from its first drawing, and a dialog up holds it back; two unlocks
  at once show one after the other. The screen shows it through the interface's palette,
  as it shows an object in hand, so a dark level does not hide it. GAME's ACHIEVEMENT
  NOTICES, on by default, turns it off; the unlock is stored all the same. Each tier has
  its colour (`TIER_COLORS`): easy orange, silly cyan, weird green, hard yellow.

- **The dialog** (`src/renderer/ui/AchievementsDialog.ts`) lists the set's achievements
  in the canvas, for the playthrough being played: the tracker's history, so a save
  loaded shows what that save had unlocked. It opens from the settings: GAME's
  ACHIEVEMENTS button puts it up in the settings' place, and is inert where the page
  tracks none. No key opens it: the settings are a click or Esc away on every screen,
  touch screens included, and a key of its own would be one more for the KEYS tab. Its
  title says how many are unlocked; a row an achievement, in the file's order, its name
  and its tier, in the tier's colour once unlocked and grey until then; a panel at the
  foot says whether the selected one is unlocked and its text, and, for one that needs
  the whole game in a game from a save that kept no history, that it needs a game played
  from its start. A click selects a row, the wheel, the scrollbar's arrows and the up
  and down keys move through the list, and Esc, CLOSE or a right click close it. It
  holds the clock as every dialog does, its stop named `achievements` in a recording.

- **The welcome page's book** has an ACHIEVEMENTS tab beside DOCUMENTS and RECORDINGS
  (`showAchievements`, `src/ui/welcomePage.ts`), a local set's too: the set's
  achievements in the file's order, how many this browser has unlocked, and each with
  its name, its tier in its colour, its text, and the playthroughs that unlocked it, the
  first first, each by the party then, the day and the time played. An achievement across
  games that the browser's figures of every set make yes is unlocked though no row of the
  set holds it yet, "Unlocked across your games": Grand Slam, once the other dungeon is
  won, before a game of this one has written its row. A row whose achievement the file no
  longer has is not listed; the store keeps it.

`tools/checks/achievements-page.ts` proves the history through F5, F9 and a fresh page's
read, a new game's whole and an import's not, RISE's adventure whole and a later CSB
save not, the store's rows, the teleport earning
nothing, the figures merged and an achievement across games unlocked over a stored
playthrough's and the live game's, and over another set's where it names that set's games,
the banner's turns and the dialog's, on the stand-in page
(`StandInPage.track`); `tools/probe-frames.ts` that the viewer tracks nothing, and an
unlock's IndexedDB row, its banner (frame 34), ACHIEVEMENT NOTICES, the dialog
(frame 35) and the book's tab.

## Identity

The server's half is `server/identity.ts`, in the store's SQLite file beside the statistics
(`doc/DEPLOYMENT.md`), so the nightly backup holds it.

- **A public name** is 3 to 16 ASCII letters, digits, `-`, `_` and `.`, in words a single
  space apart, so that no two names differ by spaces a list does not show
  (`publicNameProblem`, `src/data/DataSets.ts`, which the page and the server share). It
  is unique regardless of case: the `identities` table's `name` is `COLLATE NOCASE`. A
  name is chosen and changed as often as its player likes.
- **Its public id** is ten characters of Crockford's base 32 (`PUBLIC_ID`), drawn by the
  server when the name is first chosen, and never changed: the Hall's pages link by it.
- **Several `playerId`s share one identity** (`identity_players`): the browser that chose the
  name, and every one linked to it since. Each answer speaks for them all.
- **The identity key** is 25 characters of the same alphabet, some 125 bits, drawn with the
  identity and answered once. The server keeps only its SHA-256, which needs no salt nor a
  slow hash against a key so drawn. Given in another browser, or in the same one after its
  data was cleared, it links that browser's `playerId` to the identity, which it leaves any
  other for. The key is read in any case, its `-` and spaces dropped, an `O` as `0` and an
  `I` or `L` as `1` (`identityKeyOf`). A key drawn again refuses the old one.
- **A moderator resets a name** (`POST api/identities/<public id>`, `{"action": "reset"}`):
  the identity keeps its id, its key and its browsers, and has no name until its player
  chooses another. The name is retired (`retired_names`), refused to everyone from then on.
  The moderator does it from the name's page in the Hall of Fame ("Moderation", below).
- **A name chosen, changed or reset is told to the moderators** (`server/notify.ts`,
  `doc/DEPLOYMENT.md` → "Notifications"): the name, the one it replaces, its public id and
  who did it, so that a moderator sees each name the Hall shows. A link, a key drawn and a
  name refused tell nothing.
- **What the server knows about you**, `GET api/profile`, answers the `playerId` that asks
  and its identity's other browsers (`PlayerProfile`): the identity, its name, its id and
  how many browsers share it; the sets they published and the state of each; the recordings
  they shared, the state of each, and how many the site lists as replays; their games the
  statistics' log holds, games started, won and lost, by set (`StatsStore.playerCounts`,
  through the log's `events_by_player`); and their achievements by set, those the replays of
  their proofs verified ("Proofs"). A session, which the log keeps no row of, is nobody's.

**PROFILE** (`src/ui/profile.ts`) is the welcome page's header's first button, at its
top right corner, beside the moderator's switch, and `#profile` in the address. Its dialog,
in ABOUT's look, starts with "I shall be known on the server as:", the name's field and
SAVE, which says beside it whether the name is refused (checked in the page first), taken
or saved; then, once there is a name, its public id; when a name is first chosen, or NEW
KEY draws another, the identity key, shown this once, with COPY; and a field that takes a
key from another browser, with LINK. Under it, "What the server knows about you": the
dump, each part a heading and its rows, asked again after each change. A browser that
keeps no `playerId` asks nothing and is told the server holds nothing of it; choosing a
name or linking draws one. `tools/probe-frames.ts` proves it against the dev server's
`api/profile`: the button, a name refused, taken and saved, the key and COPY, a wrong key
refused, the key linking the browser that shared a recording to the one that published a
set, and the dump listing both.

No answer holds a `playerId`. `POST api/profile` takes a body of 1 KB at most, at 30
changes an hour per address, refused ones included (`PROFILE_CHANGES_PER_HOUR`,
`server/server.ts`). `tools/checks/server-identity.ts` proves the routes: the name's rules,
its uniqueness regardless of case, the key linking a second browser and the dump answering
both, a wrong key refused, a new key, a moderator's reset, the dump's authorship and
counts, the limits, and no `playerId` in any answer.

## Proofs

**The proof is the recording.** A player who has chosen a public name sends the package of
a point the store keeps, a save or the game's end (`doc/RECORDING.md` → "Shared
recordings"), with the unlocks it claims. The claimed unlocks are listed at once as
unverified.

**The server's half** is `server/proofs.ts`, in the store's SQLite file: `proofs`, a row per
package sent, with its sender's `playerId`, its set, its build and level, and how far it
has got (`queued`, `checked` or `drifted`), and `claims`, a row per achievement it claims,
each `unverified`, `verified` or `dropped` (`ClaimState`, `src/data/DataSets.ts`). The
package is kept in `PROOFS_DIR` (`proofs/` beside the store), never served.

- **`POST api/proofs`** takes a form of two fields (`PROOF_FIELDS`): the package, read with
  the page's own reader as a shared recording is (`readRecordingPackage`), which checks its
  form alone, and the claims, a JSON list of 0 to 64 distinct ids (`CLAIM_ID`, `MAX_CLAIMS`):
  a proof sent because its figures grew claims nothing.
  Only a browser whose identity has a public name sends one; a set the site does not
  publish, a package that does not read and one holding a move of `?dev`, which earns
  nothing, are refused; an identity's browsers have at most 8 proofs queued at once
  (`MAX_QUEUED_PER_IDENTITY`), and the packages kept take at most 1 GiB. It answers
  `{"id": …}`, sixteen hexadecimal digits the page keeps beside the unlocks it claims, at
  20 proofs an hour per address, refused ones included (`PROOFS_PER_HOUR`,
  `server/server.ts`), a body of 8 MiB and 64 KB at most (`MAX_PROOF_BYTES`).
- **`GET api/proofs?ids=<id>,…`** answers the verdicts of those of the asker's identity's
  proofs (`ProofVerdict`): the state, why a drifted one drifted, and each claim's state.
  Another's proof is left out. Neither route's answer holds a `playerId` or a playthrough.
- **The profile** (`GET api/profile`) lists the achievements the replays verified, by set,
  each once, the first verified first (`ProofStore.verifiedBy`).

`tools/checks/server-proofs.ts` proves the routes: the name required, the form's refusals,
a proof queued with its claims unverified and its verdicts answered to its identity's
browsers alone, the limits, and no `playerId` or playthrough in any answer.

**The verifier** (`server/verifier.ts`) is a service of its own, a second container from
the same image (`docker-compose.yaml`), given half a CPU and a low weight beside the others,
which lowers its own priority to the lowest at start-up: the game's server comes first. It
replays one queued proof at a time, the oldest first (`verifyNext`, `server/proofs.ts`),
with the page's replay built for Node (`replayProof`,
`src/engine/achievements/ProofReplay.ts`): the server bundles it as a second module,
`dist/server/VerifierReaders.js` (`src/engine/VerifierReaders.ts`, `vite build --ssr
--mode verifier`), with the whole engine, a page without the DOM and the build's common
file, merged with the `achievements.txt` of the set the package names, read from its
folder, beside the main server's readers (`PageReaders.js`), which never load it.

- The package is read with the page's reader, its set found by its files' digests among
  every set the store holds (`findRecordingSet`, the digests of each set's folder, as
  `api/data-set-files` digests them), and its path played to its point as the page plays a
  cut before it uploads it (`playCut`), each recording at its own engine level
  (`RecordingPlayer`, `Behaviour`), the tracker attached with the build's achievements of
  the package's set.
- **Played to its point**, the proof is `checked`, and its playthrough is the one the replay
  read there (`d.RandomGameID`). Each claim the replay's history holds is `verified`, each
  other `dropped`, and an unlock it holds that the page did not claim is granted,
  `verified`, all the same: the replay is the authority, not the claim. Its history's
  figures there (`GameFigures`, "Across games") are kept, each above 0, in
  `proof_figures`, a row per proof and key.
- **Where it does not**, it drifts, a later level's, a package that does not read and one
  whose files no set has among them, the proof is `drifted`, the reason kept and answered,
  its claims `unverified`, and its file kept.
- **A proof that verified nothing of its own**, nothing an earlier proof of its identity's
  browsers had not verified in the same playthrough, has its file deleted once checked
  (`ProofStore.dropFile`); its row, its claims and its figures stay. Figures that grew
  alone keep no file. A proof that did is kept, and the
  nightly backup copies its package once (`server/backup.ts`, `doc/DEPLOYMENT.md` →
  "Backups").

`tools/checks/server-proofs.ts` proves the verifier over the repository's sets, with the
page's source: a genuine corpus recording (`replay-saves-written-over`) whose forged claim is
dropped and whose First Blood is granted, the same game again verified but not its own and
its file deleted, a game unlocking nothing whose claim is dropped, a package whose save
differs and one made by hand left unverified with their reasons, the same game claiming
nothing, its two kills kept as its figures, a drifted proof keeping none, the verdicts as
the page asks them and the profile. `tools/checks/build.ts` proves the built module replays as the
source does, and `tools/check-image.sh` runs the verifier in its own container beside the
server's, a proof sent to the server checked by it.

**CSB's adventure**, made by RISE from the prison's save (`Chaos.ts`), begins its recording
at a save no replay holds a state for, which the verifier's tracker, given the set's
`mini.dat`, tells as the page's does: its history is the whole game's on both ("A CSB
adventure"). A player who wants a verified run seen shares the same point through the
book's UPLOAD, the shared recordings' moderation ("Shared recordings", `doc/RECORDING.md`):
nothing links the two.
**Deferred:** replaying the kept proofs again when a set gains an achievement, which phase
18.7's sets' own files make possible without a deploy. A moderator watching a proof that
looks suspicious plays or downloads its kept package from the Hall ("Moderation", below).

**The page's half** is `PageProofs` (`src/engine/achievements/PageProofs.ts`), built beside
`PageAchievements` for a game the player plays, never for a recording's viewer, over the
server's routes (`src/ui/proofRoutes.ts`). Only a browser whose player has a public name, as
`api/profile` says, sends anything.

- **What a proof claims** is the playthrough's rows that its history holds and no replay
  has judged (`claimableRows`): an unlock of a branch the game left is on no path it can
  send, and one a replay dropped the same game's later path would not unlock either. A
  playthrough a teleport touched has no rows, so it claims nothing.
- **When it is sent**: at a save (`GameSaves.onSaved`), the history its row kept as its
  file was made (`SaveEntry.achievements`), when it claims an unlock no proof has claimed
  yet or its figures grew, and this page sent none of the playthrough for ten minutes
  (`PROOF_INTERVAL_MS`); and at the game's end, when it claims anything or its figures
  grew. Its **figures grew** where one of its history's figures (`figuresOf`) is past the
  largest the proofs this page sent of the playthrough held, so that a game that unlocks
  nothing new still counts across games; a page loaded afresh knows of no proof sent, and
  sends one more. A playthrough a teleport touched has no figures. The package is the store's point, packed as
  the book's UPLOAD packs it, titled `Proof` (`storedPackage`): the save's, its recording
  written to the store first, or the set's latest game's end.
- **Each row claimed keeps the proof's id** (`AchievementRow.proofs`). The page asks for the
  verdicts its rows await at its start and every two minutes (`refreshVerdicts`), the book's
  ACHIEVEMENTS tab as it opens, and writes them (`judgedRows`): a row is `verified` once a
  proof verified it, `dropped` once every proof that claimed it was replayed and none did,
  and keeps the reason where one drifted. An unlock a replay granted unclaimed is the
  server's alone: PROFILE lists it, and the browser adds no row for it. The store's shape
  is the same, so IndexedDB's version stays 8.
- **Shown**: the dialog's detail says UNLOCKED, VERIFIED or UNLOCKED, NOT VERIFIED; the
  book's tab says of each playthrough's unlock "verified", "not verified", "awaiting the
  server" or "its replay drifted", and nothing where no proof claimed it; PROFILE's "Your
  achievements, verified" lists the server's by name. An achievement across games, which
  no proof claims, is UNLOCKED, NOT VERIFIED in the dialog and has nothing in the book:
  PROFILE says whether the server counts it. ABOUT tells the player the recordings are
  sent, kept and replayed.

The dev server is its own verifier: it replays each proof as it is queued, in its own
process (`vite.config.mts`). `tools/checks/achievement-proofs.ts` proves the verdicts, the
claims, when the page sends, a proof claiming nothing where the figures grew among them,
the package of a save the store keeps, replayed to First Blood and its kills by the
verifier's replay, and the whole CSB game, from the adventure's start, to
Speed Runner; `tools/probe-frames.ts` a proof the live page sends with a
name, replayed by the dev server, First Blood verified and Pest Control dropped, and the
book saying so.

An unlock on a branch that the player later reloaded away from is on no path they can send,
so it stays in the browser.

## The Hall of Fame

**The answers** are `server/fame.ts`, public and cached as `api/stats`'s are, for 30 s
(`STATS_CACHE_MS`, one `AnswerCache` with the statistics'), over the proofs the replays
checked (`ProofStore.hall`). GET only, 404 for an unknown set or id, and none holds a
`playerId`, a playthrough or a proof's id: a player is their public name and public id.

- **A player of the Hall** is an identity with a public name, counted once whatever browsers
  it links (through `identity_players`: a browser linked to another identity since speaks
  for that one), who verified an achievement of the set. An identity a moderator reset has
  no name, and is in no answer until its player chooses another.
- **An achievement verified** is a claim `verified` by a checked proof, the replay's grants
  among them; an unverified claim, a dropped one and a drifted proof's count for nothing.
  Its time is the time its first proof of the identity's was checked (`checked_at`), not
  sent.
- **An achievement across games verified** is one the figures of the identity's checked
  proofs make yes (`acrossRows`, `server/proofs.ts`): its proofs of every set are taken in
  the order they were checked, each playthrough at the largest figure any of its proofs
  reached so far, never their sum, and the conditions of each set it has proofs of
  tested over them after each (`achievementsAcross`, which the page's readers export
  beside `achievementDefs`, each set's file read from its folder). Its time is that of the proof after which the condition was
  first yes, a proof of another set's where it reads that set's games, as Grand Slam
  does. PROFILE's
  achievements (`ProofStore.verifiedBy`) count them the same way.
- **The sets** are the public ones, approved and not hidden, as `api/stats`'; **their
  achievements** each set's `achievements.txt`, read from its folder, merged with the
  common file by the page's readers, `dist/server/PageReaders.js` exporting the merge as
  the verifier's module does (`folderAchievements`, `loadPageReaders`). An unlock whose id
  the set's file no longer holds is not counted.
- **`api/fame`** (`fameSummary`): how many players the Hall has, and each set, the most
  players first, then in the table's order: its players, its achievements and how many of
  them someone verified.
- **`api/fame/sets/<id>`** (`fameSet`): the set's players, and each achievement in its
  file's order, its name, text and tier, how many players verified it, their share of the
  set's players, and who verified it first, by `checked_at`, then by public id.
- **`api/fame/players/<public id>`** (`famePlayer`): the player's name, and their badges by
  public set, each set's in its file's order, with the day, UTC, its first proof was
  checked. A named player who verified nothing has a page with no set; an identity without
  a name is 404 at once, though the sets' answers may still show it until they expire.

The dev server answers the routes over its own proofs, uncached (`vite.config.mts`).
`tools/checks/server-fame.ts` proves the answers: two browsers of one identity counted once,
the first by `checked_at` and not by the time sent, a reset name left out and its page 404,
pending and hidden sets left out, dropped, unverified and drifted claims and an unlock the
file does not hold not counted, each achievement in its file's order, a player's badges and
their days, the 404s, the cache, and no `playerId`, playthrough or proof id in any answer;
and the achievements across games out of the proofs' figures, a playthrough at its
largest and not its proofs' sum, Dungeon Janitor at the proof past 500 kills and Encore at
the third game won, a drifted and a queued proof's figures not counted, a Janitor verified
in one game still counted, a Grand Slam of two sets at the proof of the second, and the
profile the same. `tools/checks/build.ts` proves the built readers hold the source's
achievements and work those across games out of figures, Grand Slam out of the Amiga's
Dungeon Master and Chaos Strikes Back.

**The page** is `/fame` (`fame.html`, Vite's third entry, `src/fame/famePage.ts`), in the
statistics page's look (`doc/STATISTICS.md`), which loads none of the game's code: the
routes' names are its own copies, as the statistics page's are. The welcome page's footer
links to it beside the statistics, ABOUT tells of it, and PROFILE's public id links to the
player's own page, `fame#<public id>`, once they have a name.

- **The band** says how many players the Hall has and how many dungeons have one; **the
  column**, the sets in `api/fame`'s order, each its players and how many of its
  achievements were earned. A click selects one, `?set=<id>` in the URL, the other
  parameters kept; with none, the column's first is selected.
- **The selected set**: its players, achievements and those earned, and each achievement in
  its file's order, its name, its tier in its colour (the banner's, as the book's), its
  text, a bar of the share of the set's players who earned it with their count and the
  share, and its first, a link to their page; one nobody earned is dim, "Nobody yet."
- **A player's page**, `fame#<public id>` or `?player=<public id>`, in the set's place:
  their name, how many badges and dungeons, and their badges by set, each set's name a link
  to it, each badge with its tier, its text and the day it was verified. An id no player of
  the Hall has says so.

`tools/probe-frames.ts` proves it against the dev server, after its proof is verified: the
footer's link, none of the game's code loaded, the band, the column and the set's
achievements as `api/fame` answers them, the prover First Blood's first, their page at a
click on their name, back to the set, and an unknown id; and PROFILE's link to the page.

**Moderation.** To a moderator whose switch is on (the welcome page's, kept in
`localStorage`), a player's page ends with MODERATION, from `GET api/identities/<public id>`
(`identityText`, `server/identity.ts`), which answers a moderator alone, uncached, and never
a `playerId` nor a playthrough: how many browsers share the identity, and its browsers'
proofs, the latest sent first, each its set, when it was sent, how far it got, why it
drifted, its claims' verdicts, the replay's grants among them, and whether its package is
kept.

- **RESET NAME** asks a second click, CONFIRM RESET, then withdraws the name (`POST
  api/identities/<id>`, "Identity"): the Hall's answers leave it out, its page at once, the
  sets' once their 30 s are up, and the page, asking again past the browser's cache, says
  no player has this id, MODERATION staying so that its proofs can still be read.
- **A proof that looks suspicious** is watched by its package, which the server keeps and
  never serves, but to a moderator: `GET api/proofs/<id>` (`answerProofPackage`,
  `server/app.ts`) answers its bytes as sent, uncached, and 403 to anyone else, its sender
  included, 404 where the verifier deleted it as proving nothing new. PLAY opens it in the
  game's page, `?recording=proof:<id>` (`fetchProofRecording`, `src/main.ts`), the
  recording's viewer playing it as a site's recording; DOWNLOAD saves it,
  `proof-<id>.gz`, a shared recording's package that the tools read.
- **Deferred:** a moderator undoing a proof's verdict, a claim verified turned dropped,
  when a replay shows a game won by a bug the verifier cannot tell apart: the remedy is the
  name's reset, which takes the identity out of the Hall whole.

`tools/checks/server-identity.ts` proves the identity's answer (403 to anyone but a
moderator, its own player too, 404 an unknown id) and the notifications;
`tools/checks/server-proofs.ts` the proofs listed to a moderator and the package's route
over the verifier's own proofs; `tools/probe-frames.ts` MODERATION to the dev server's
moderator, the proof's verdicts, PLAY playing it, DOWNLOAD's fetch, and RESET NAME's two
clicks and the name withdrawn.
