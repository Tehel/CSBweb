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
(`src/engine/achievements/`), and the common file. The rest of this document is the design
that `PLAN.md` phase 18 builds, step by step, and each step rewrites its section here to
say what was built.

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

An `item` is the object's name as the game shows it, from the set's own `graphics.dat`.
A name that a set's objects do not have matches nothing. The common file names FTL's
objects, so in a set that renamed one of them, that name simply matches nothing. In a set's
own file, such a name is an error, which the set's check reports (`unknownItems`).
A `monster` is named by its type (the names are set in phase 18.2). A `champion` is the
name the champion carries.

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

*Designed (phase 18.2).* The engine tells its host what happened through one new
`GameHost` member, `observe(happening)`. Like `trace` and `tracing`, it comes with a flag,
`observing`, so that nothing is built when nobody is listening. A call changes no state,
draws no random number and changes no path through the code. So it changes nothing in a
tick, and needs no `ENGINE_LEVEL` (`doc/RECORDING.md` → "The policy"). The replay corpus,
which plays the same with or without a listener, proves it.

The calls go where the engine knows what happened:

- **The kills** are where `damageMonster` is called (`MonsterDamage.ts`): melee, missiles,
  clouds, doors, pits and Fusion.
- **The damage to a champion** is where `damageCharacter` is called. The damage is only
  pending until the tick applies it, so the tracker keeps each champion's last cause, and
  `killCharacter` reports the death with it. Damage from `adjustStamina` while the food or
  the water is below −512 is starvation or thirst; any other is fatigue.
- **The meals** are at `handleMouthPress` and at the fountain. The stand-in page runs that
  code in a replay too.
- **The spells** are at `castSpell`.
- **A missile records nobody as its owner.** The tracker tags each missile the party
  launches by its RN, and follows that RN into the explosion it makes. That is what
  `party: yes` means. The missile's whole life must be read in CSBWin before these calls
  are placed.

**The tracker** (`AchievementTracker`) turns what it observes into the evaluator's events
and samples. It is a function of what it observes and of the VBLs run, and of nothing else,
so a live game and its replay give the same unlocks. Its state is saved beside each save, in
the save's row in the store (`SaveEntry`), never in the CSBWin file. A replay restores that
state at each join from the state its parent had at the save. A save without that state
starts a history of its own ("Some conditions need the whole game", above). A playthrough moved with `?dev`'s teleport
earns nothing, as its statistics count nothing. A recording played back in the viewer
earns nothing either.

## The page

*Designed (phase 18.3).*

- An `achievements` store in the IndexedDB database keeps one row per set, achievement and
  playthrough: when the achievement was unlocked, the play time, and how far its proof has
  got.
- An unlock shows for three seconds as a banner over the viewport, drawn after the game,
  never in the message area, which is the engine's. A setting, ACHIEVEMENT NOTICES, turns
  it off.
- A dialog drawn in the canvas lists the set's achievements.
- The welcome page's book has an ACHIEVEMENTS tab, and PROFILE holds the public name and
  the identity key.

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
