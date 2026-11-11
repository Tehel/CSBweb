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
history in each save's row, and the store of the unlocks ("The page"). The rest of this document is the design that `PLAN.md` phase 18
builds, step by step, and each step rewrites its section here to say what was built.

## The file

A set's achievements are `achievements.txt`, an optional file in the set's folder, like
`hcsb.hct`. The common achievements, which every set has, are
`src/engine/achievements/defs/common.txt`. The FTL sets' own achievements are written by the
project, as `src/engine/achievements/defs/<set id>.txt`, and a set with no
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

A file with any error is refused as a whole. Each error names its line.

### Conditions

A condition is a yes or a no, made from these parts:

- `and`, `or`, `not`, parentheses, and the comparisons `=`, `!=`, `<`, `<=`, `>`, `>=`
  between two numbers of the same kind.
- **Numbers**: integers, such as `100`. **Durations**: `3h`, `90m` and `45s`, which are
  seconds and compare only with `playTime`.
- **Facts about the game**:
  - `won`, `lost` and `ended` are yes only once the game has ended, won or lost.
  - `gameTime` is the game's clock, `d.Time`, in ticks: about four a second when the party
    is awake.
  - `playTime` is the time the player has played the game, in seconds. It counts the
    VBLs the game has run, sixty a second, so the page and a replay of its recording
    count the same.
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
| `kill` | a monster dies | `monster`, `by`: `melee` `spell` `throw` `explosion` `cloud` `door` `pit` `fusion`; `item`, the object thrown or swung; `champion`, who struck; `party`: `yes` when the party's own blow, spell or throw killed it |
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
It reads the game only to name things: a champion, an object, the samples.

- At each tick's end it takes the samples: `party` and `alive` leave out a mirror's
  champion; `coins` counts every object whose name ends in `COIN` in the party's
  possessions, inside the chests they carry (an open chest's slots for the open one) and
  under the pointer. It sets the clock, adds the VBLs counted, and tests the conditions.
  At `MainLoop`'s return it does the same and says the game ended.
- It keeps its state by the MD5 of each save's file it sees made, and when a file is read
  it takes up the state kept for it: a replay's joins read the files their parents made, so
  each branch goes on with its parent's history. A file read with no state kept starts a
  history of its own ("Some conditions need the whole game"); a new game starts one from
  its start.
- `snapshot` and `keep` give the page the state to store beside a save and to give back
  at a read ("The page").

`tools/checks/achievements-tracker.ts` proves it on the corpus: each join reads its
parent's state, a path from a new game keeps its whole history and one from a CSBWin save
does not (Speed Runner stays locked in the whole CSB game), and the kills, the deaths and
their causes, the joins, the meals, the worn objects and the unlocks of Dungeon Master won
(DMMovie2615), a lost game and the whole CSB game.

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
  one, a new adventure made by RISE) starts a history of its own, which is not the whole
  game's. The history is the store's alone: an export carries the CSBWin file and nothing
  else, and CSBWin reads every export (`doc/SAVES.md`).
- **The `achievements` store** in the saves' IndexedDB database (version 8,
  `BrowserAchievementStore`) keeps one row per set, achievement id and playthrough
  (`AchievementRow`): when it was unlocked, the player's time then (the tracker's VBLs),
  the game's clock, the party's names, and how far its proof has got, only `unverified`
  until the proofs are sent (phase 18.5). A row is written as the tracker unlocks, unless
  one of the same key is there: the first unlock stays when a branch loaded since unlocks
  it again.

`tools/checks/achievements-page.ts` proves the history through F5, F9 and a fresh page's
read, a new game's whole and an import's not, the store's rows, and the teleport earning
nothing, on the stand-in page (`StandInPage.track`); `tools/probe-frames.ts` that the
viewer tracks nothing.

Still to come in phase 18.3:

- An unlock shows for three seconds as a banner over the viewport, drawn after the game,
  never in the message area, which is the engine's. A setting, ACHIEVEMENT NOTICES, turns
  it off.
- A dialog drawn in the canvas lists the set's achievements.
- The welcome page's book has an ACHIEVEMENTS tab.

## Proofs and the Hall of Fame

*Designed (phases 18.4 to 18.6).*

**The proof is the recording.** A player who has chosen a public name sends the package of
a point the store keeps, a save or the game's end (`doc/RECORDING.md` → "Shared
recordings"), with the unlocks it claims. A package is sent at the game's end when the
game unlocked anything, and at a save after a new unlock, at most every ten minutes per
playthrough. The claimed unlocks are listed at once as unverified.

A **verifier** service, a second container from the same image, given half a CPU and a low
priority, replays one queued package at a time with the tracker attached. It finds the
set's files by their digests and plays at the package's own engine level. What the replay
unlocks becomes verified, and a claim the replay does not make is dropped. A package that
drifts stays unverified.

An unlock on a branch that the player later reloaded away from is on no path they can send,
so it stays in the browser.

**The packages are kept** on the server, privately, about 14 KB an hour of play. When a set
gains an achievement, its kept games can be replayed at idle priority, and the new unlocks
granted to them. A moderator can watch a run that looks suspicious. Its player may publish
it as a replay, through the shared recordings' moderation. A package that granted nothing
of its own is deleted once it has been checked.

**Identity.** A public name is 3 to 16 ASCII letters, digits, spaces, `-`, `_` and `.`,
unique regardless of case. A moderator may reset one. Each name has a public id, ten random
characters, which the Hall's pages link by. The server keeps its players' `playerId`s
apart, and several of them can share one identity. An **identity key**, a random secret
that the server keeps only as a hash, links another browser's `playerId` to the identity,
or links a browser again after its data has been cleared. No `playerId` ever travels.

**The Hall of Fame** (`fame.html`) shows each set's achievements with how many players of
the Hall have unlocked each, the share that is, and who unlocked it first; and each player's
page of badges. Its answers, like `api/stats`, never hold a `playerId` or a playthrough.
