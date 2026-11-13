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
`hcsb.hct`. The common achievements, which every set has, are
`src/engine/achievements/defs/common.txt`. The FTL sets' own achievements are written by the
project, as `src/engine/achievements/defs/<name>.txt` (`achievementFileOf`,
`src/engine/achievements/PageAchievements.ts`): `dm-atari.txt`, which every Dungeon Master
set reads, the Atari's, the Amiga's and the hidden ones, and `csb.txt`. Both give the
common file's values: Speed Runner in less than 180 minutes, Blitz in less than 60, and
Conscientious Objector with at most 40 kills. A set with no
`achievements.txt` of its own reads that file instead. The file is never a game file
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
- **`value name = number`**, on a line of its own before the first block, defines a named
  value: a whole number from 0 to 1,000,000,000, its name 1 to 40 letters and digits, a
  letter first. A text names it as `{name}`, and a condition where a number would be, as
  `{name}`, or `{name}m` for that many minutes (`h` and `s` too), a duration
  ("Conditions"). The common file names values and defines none; a set's own file defines
  them:

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
  book, no unlock. A set without a file of its own, a player's, has none of the valued
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
- **Counts of the set's data**: `spells`, `foods` and `monsterTypes`, numbers worked out
  from the set's own files, the same in every game of the set ("Counted from the data").
- **Samples**, read at the end of each tick. A sample's bare name is its value at that moment:
  - `party`: the number of champions in the party.
  - `alive`: the number of those champions who are alive.
  - `coins`: the number of coins the party carries, counting the champions' hands, packs,
    pouches and quivers, the chests carried, and the object held under the pointer. A coin
    is any object whose name ends in `COIN`.
- **`max(sample)`** and **`min(sample)`** are the largest and the smallest value the sample
  has had in the game.
- **Counts of events**:
  - `count(event)` is how many times the event has happened in the game.
  - `count(event where filter)` counts only the events that the filter accepts.
  - `ever(event [where filter])` means the count is at least 1.
  - `never(event [where filter])` means the count is 0.
  - `distinct(event.attribute [where filter])` is how many different values the attribute
    has had among the events counted.

A **filter** is made of `and`, `or`, `not`, parentheses, and these tests on the event's
attributes:

- `attribute = value` and `attribute != value`.
- `attribute in (value, …)` and `attribute not in (value, …)`.
- `attribute ~ "pattern"`, where `*` in the pattern stands for any run of characters and
  `?` for one character.

A value is a word, such as `APPLE`, or a quoted name, such as `"DRAGON STEAK"`. Names
compare without regard to case.

### The events

| Event | When | Attributes |
| --- | --- | --- |
| `kill` | a monster dies | `monster`, `by`: `melee` `spell` `throw` `explosion` `cloud` `door` `pit` `fusion`; `item`, the object thrown or swung, or the bomb whose explosion killed; `champion`, who struck; `party`: `yes` when the party's own blow, spell or throw killed it |
| `hurt` | a champion takes damage | `champion`; `by`: `monster` `missile` `explosion` `cloud` `door` `pit` `wall` `poison` `starvation` `thirst` `fatigue` `potion`; `party`: `yes` when it came from the party's own missile or spell |
| `death` | a champion dies | `champion`; `cause`, as `hurt`'s `by`: the last damage the champion took |
| `eat` | a champion eats | `champion`, `item` |
| `drink` | a champion drinks, a potion or water, or from a fountain | `champion`, `item` (`FOUNTAIN` for a fountain) |
| `cast` | a champion casts a spell | `champion`; `spell`, its runes, such as `"FUL IR"`; `ok`: `yes` when the spell worked |
| `wear` | an object is put on a worn place | `champion`; `slot`: `head` `neck` `torso` `legs` `feet`; `item` |
| `join` | a champion joins the party | `champion`; `how`: `resurrect` `reincarnate` |

An `item` is the object's name as the game shows it (`RN::NameIndex`), from the set's own
`graphics.dat`.
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

### Counted from the data

Three numbers a condition reads are the set's own, so that one condition says "every one
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

A set's dungeons are its `dungeon.dat`, and its `mini.dat` where it has one, Chaos Strikes
Back's adventure. Dungeon Master counts 25 spells, 8 foods and 24 types; Chaos Strikes
Back 25 spells, 8 foods and 23 types, three of them only its generators make
(`tools/checks/achievements-format.ts`).

Each count is that of the values its event can take in a game of the set, so `distinct(…)
>= count` is exact: a spell that works is one of the table's, a meal one of the foods, a
monster a blow kills one of the types. A dungeon whose DSAs create a monster or a food of
a kind the counts leave out, or make something else edible, can reach the count with it
instead. A set whose count is 0 has nothing to earn, so the common file's conditions ask
for more than 0 first.

The tracker works the counts out as it is made (`dataCounts`,
`src/engine/achievements/DataCounts.ts`), from the game's tables and the set's dungeon
files, and puts them in the conditions (`withCounts`). The welcome page and the Hall of
Fame list a set's achievements without its files, so a text cannot name a count as it
names a value: Gourmet says "every kind of food", not "the 8 kinds".

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
  (`poisonCharacter`), a potion that takes health off (`applyFeedParameters`), and Lord
  Chaos fused (`_FusionSequence`, his type as the sequence finds him: it flips it to the
  mon_25 graphic and back before the Grey Lord).
- **The stamina's damage** (`adjustStamina`) is starvation while the champion's food is
  below −512, else thirst while the water is, else fatigue: the thresholds below which
  `TenSecondUpdate` takes stamina for them (`doc/CSBwin-src/Code17818.cpp:289`, `:313`).
- **A monster dies** where `DamageMonster` finds a member's death, whether the group is
  removed then or by the move it was hurt in (`apply` false): once a member. A member at
  0 HP that `ProcessTimers29to41` removes (`MonsterAI`) dies inside no blow, and is
  nobody's kill. `DeleteMonster` and `DeleteMonsterInGroup` alone kill nobody: a group
  the party lands on, the monsters Fusion clears from the level, a DSA's, a full
  database's.
- **A champion is hurt** where `DamageCharacter` adds to the pending damage, and **dies**
  at `KillCharacter`. The damage is pending till the tick's `DisplayCharacterDamage`, so
  the tracker keeps each champion's last cause, and a death outside any blow takes it.
- **The meals** are at `handleMouthPress`: a meal chewed is eaten, a waterskin's or a
  potion drunk. Drinking at a fountain (an extra) is `FOUNTAIN`. The stand-in page runs
  that code in a replay too.
- **The spells** are at `CastMagic`, around `castSpell`: the runes it reads, the
  champion's or a spell filter's, and whether it returned 1. A DSA's `&CAST` and a
  weapon's spell are not the player's cast.
- **A worn object** is at `AddCharacterPossession` into the head, the torso, the legs or
  the feet (slots 2 to 5) or the neck (10), the slots whose `CarryLocation` is those
  places' masks (`doc/CSBwin-src/CSB.h:1682-1687`, which the check reads in
  `graphics.dat`). A mirror's champion's own possessions are not put on by the player.
- **A join** is at the end of `_ResurrectReincarnateCancel`, beside
  `GameHost.championJoined`.
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
the `mini.dat`.

- At each tick's end it takes the samples: `party` and `alive` leave out a mirror's
  champion; `coins` counts every object whose name ends in `COIN` in the party's
  possessions, inside the chests they carry (an open chest's slots for the open one) and
  under the pointer. It sets the clock, adds the VBLs counted, and tests the conditions.
  At `MainLoop`'s return it does the same and says the game ended.
- It keeps its state by the MD5 of each save's file it sees made, and when a file is read
  it takes up the state kept for it: a replay's joins read the files their parents made, so
  each branch goes on with its parent's history. A file read with no state kept starts a
  history of its own ("Some conditions need the whole game"), unless it is a CSB
  adventure's start, read against the set's `mini.dat` ("A CSB adventure"), which starts
  one from its start, as a new game does.
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
spells, foods and types reach the counts: the whole CSB game eats all eight foods.
`tools/checks/achievements-format.ts` reads each file, checks its names against its set's
`graphics.dat` and its values against its achievements, counts the FTL sets' data, and
plays the conditions out of made-up events, the named values and the counts put in their
places.

## The page

The page tracks the achievements of a game the player plays (`PageAchievements`,
`src/engine/achievements/PageAchievements.ts`), and of no other.

- **Its achievements** are the common file's merged with the set's own file, where the
  project has one (`setAchievementDefs`, read from the build by `src/main.ts`). A file
  that does not read leaves the game without achievements, and the console says why.
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
- **The `achievements` store** in the saves' IndexedDB database (version 8,
  `BrowserAchievementStore`) keeps one row per set, achievement id and playthrough
  (`AchievementRow`): when it was unlocked, the player's time then (the tracker's VBLs),
  the game's clock, the party's names, and how far its proof has got, `unverified`,
  `verified` or `dropped`, with the proofs that claim it ("Proofs"). A row is written as the tracker unlocks, unless
  one of the same key is there: the first unlock stays when a branch loaded since unlocks
  it again.

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
  first first, each by the party then, the day and the time played. A row whose
  achievement the file no longer has is not listed; the store keeps it.

`tools/checks/achievements-page.ts` proves the history through F5, F9 and a fresh page's
read, a new game's whole and an import's not, RISE's adventure whole and a later CSB
save not, the store's rows, the teleport earning
nothing, the banner's turns and the dialog's, on the stand-in page
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
  form alone, and the claims, a JSON list of 1 to 64 distinct ids (`CLAIM_ID`, `MAX_CLAIMS`).
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
--mode verifier`), with the whole engine, a page without the DOM and the build's
achievements, beside the main server's readers (`PageReaders.js`), which never load it.

- The package is read with the page's reader, its set found by its files' digests among
  every set the store holds (`findRecordingSet`, the digests of each set's folder, as
  `api/data-set-files` digests them), and its path played to its point as the page plays a
  cut before it uploads it (`playCut`), each recording at its own engine level
  (`RecordingPlayer`, `Behaviour`), the tracker attached with the build's achievements of
  the package's set.
- **Played to its point**, the proof is `checked`, and its playthrough is the one the replay
  read there (`d.RandomGameID`). Each claim the replay's history holds is `verified`, each
  other `dropped`, and an unlock it holds that the page did not claim is granted,
  `verified`, all the same: the replay is the authority, not the claim.
- **Where it does not**, it drifts, a later level's, a package that does not read and one
  whose files no set has among them, the proof is `drifted`, the reason kept and answered,
  its claims `unverified`, and its file kept.
- **A proof that verified nothing of its own**, nothing an earlier proof of its identity's
  browsers had not verified in the same playthrough, has its file deleted once checked
  (`ProofStore.dropFile`); its row and its claims stay. A proof that did is kept, and the
  nightly backup copies its package once (`server/backup.ts`, `doc/DEPLOYMENT.md` →
  "Backups").

`tools/checks/server-proofs.ts` proves the verifier over the repository's sets, with the
page's source: a genuine corpus recording (`replay-saves-written-over`) whose forged claim is
dropped and whose First Blood is granted, the same game again verified but not its own and
its file deleted, a game unlocking nothing whose claim is dropped, a package whose save
differs and one made by hand left unverified with their reasons, the verdicts as the page
asks them and the profile. `tools/checks/build.ts` proves the built module replays as the
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
  yet and this page sent none of the playthrough for ten minutes (`PROOF_INTERVAL_MS`); and
  at the game's end, when it claims anything. The package is the store's point, packed as
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
  achievements, verified" lists the server's by name. ABOUT tells the player the
  recordings are sent, kept and replayed.

The dev server is its own verifier: it replays each proof as it is queued, in its own
process (`vite.config.mts`). `tools/checks/achievement-proofs.ts` proves the verdicts, the
claims, when the page sends, the package of a save the store keeps, replayed to First
Blood by the verifier's replay, and the whole CSB game, from the adventure's start, to
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
- **The sets** are the public ones, approved and not hidden, as `api/stats`'; **their
  achievements** the build's (`achievementDefs`, `src/ui/achievementFiles.ts`), which the
  server reads through the page's readers, `dist/server/PageReaders.js` exporting them as
  the verifier's module does (`loadPageReaders`); the server has no file of its own. An
  unlock whose id the set's file no longer holds is not counted.
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
their days, the 404s, the cache, and no `playerId`, playthrough or proof id in any answer.
`tools/checks/build.ts` proves the built readers hold the source's achievements.

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
