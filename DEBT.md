# csbweb – Technical debt

This file is the **authority on technical debt**: everything known to be wrong, divergent
from CSBWin, duplicated, or left unfinished in code that is otherwise considered done. It
lists **open items only**. `PLAN.md` carries the live phases and points here; paying this
list off is the current project priority (`PLAN.md` → "Current priority").

A paid item is deleted. Its commits name its ID, so `git log --grep C33` finds the work,
and an ID is never reused. Items paid before 2026-09-26 are in `doc/PLAN_ARCHIVE.md` →
"Resolved debt", which is where a `DEBT.md` ID cited in the code but absent here is found.

Markers are `PLAN.md`'s: ⚠️ knowingly divergent or incomplete · ⏳ not started ·
⏸️ postponed · 🚫 deliberately not done.

## Priority: a working game on the default dungeon

**The goal now is a complete, faithful game on the default dungeon** (`dm-atari`), so the
unported features it needs come next, and whatever it does not need waits. Two pieces
of work follow it, the author's next challenges: a redesigned page, and a second dungeon
(Chaos Strikes Back first). Tiers D and E hold what the
code needs before them: a base solid enough to build them on. `E15` is the page
redesign's first step.

**Conflux 3.5** (`static/gamefiles/conflux-3.5-b8/`) is the third dungeon, a data set
(`conflux`) whose first ticks play (`tools/watch-conflux-start.ts`) and whose start is a
golden frame. What waits on the author for it is C150. Its `dungeon.dat` is enciphered, and reads whole
(`doc/PROVEN_FACTS.md` → "The "simple" encipherment is `RC4.cpp`'s own cipher"). Its
skins are drawn (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Skins in the data sets"). Every DSA operation CSBWin has is ported, not only Conflux's share
(`tools/dump-dsa-census.ts`), and a dungeon with DSAs saves (`tools/dump-dsa-save.ts`).

The order, then:

1. **D and E.** New structural debt still goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** A divergence found along the way goes here and is
   taken before the G items: a known bug outranks a missing feature.
3. **G — Unported CSBWin features the default dungeon reaches**, in the index's order.
4. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**Postponed (⏸️) until the default dungeon is validated.** These are not taken in order,
and no session picks one up unless the author names it:

- **A save of a dungeon the port does not know** (G22).
- **What only another dungeon reaches** of CSBWin 20230608's own: 3D2D1D's vertical moves
  and gravity (G30), which its Extended Features block turns on.
- **CSBWin's debugging features** that are not part of the game: the ASCII dump, and the
  DSA trace, whose flags `WriteDSAs` follows the DSAs with, an `EDBT_DSAtraces` record
  (`DSAIndex.WriteTracing()`, `doc/CSBwin-src/SaveGame.cpp:1014-1018`) that a read takes
  back (`DSAINDEX::ReadTracing`, `DSA.cpp:5554-5577`). The port writes none.
- **Comparing frames against CSBWin's own screenshots** (`PLAN.md` → Phase 15, step 5):
  staging the same scene in CSBWin, without cheats, costs more than it proves.
- **X — Extras**: gameplay features CSBWin does not have, wanted by the author once the
  faithful game is complete.

A **Chaos Strikes Back** feature is *not* postponed: CSB is the next dungeon to try once the
default one is satisfying, and DM is a subset of it. A feature CSB needs stays in the
active list, even if DM never reaches it.

**H** is not debt: deliberate divergences, recorded so nobody "fixes" them.

**X** is not a divergence either: every extra sits behind one setting that is off by
default, so with it off the game is CSBWin's and the golden frames do not move.

## How to work this list

1. **One item per commit, a few per session**, in the order above, then `/clear`
   (`CLAUDE.md` → "Working economically"). `/pay-debt` (`.claude/commands/pay-debt.md`)
   starts such a session and ends it with the command for the next one. Stop before a size-M item would overrun the
   session. Split an L item into steps and record the split in its entry.
2. **Re-verify first.** Every pointer below was checked against the code when its entry
   was written, but line numbers drift. If an item turns out to be already paid, delete it
   and say how you know in the commit message.
3. **Refactors change no behaviour.** Tiers D and E are refactors: `npm test` before and
   after, and `npm test -- --frames` whenever anything under `src/renderer/` or `src/ui/`
   moves. Better still, and expected for any split of a module: every tool's full output is
   byte-identical before and after (only `dump-save-menu`, by one byte, and
   `dump-savegame`, by its payload's size, vary on their own: both carry the save's
   wall-clock date, and `dump-new-game`, by the random game ids it prints), and the
   author's runtime saves hash the same after load and
   after 600 ticks. A refactor that uncovers a divergence records it in tier C. If it is
   fixed at all, the fix goes in a **separate** commit, so every commit is either
   behaviour-neutral or a fix, never both.
4. **A fix owes the usual five things** (`.claude/skills/playtest-bug/`): the CSBWin
   citation, the fix, a `tools/` check that fails before it, a `doc/PROVEN_FACTS.md` entry
   if a new fact was verified, and the bookkeeping here.
5. **When an item is paid,** delete its entry and its index row, and rewrite or remove
   every code comment that cites its ID: an ID in the code means the debt is still open.
   Name the ID in the commit message (`Debt C33: …`); that is the record.
6. **New debt goes here,** in the tier it belongs to, with the next free ID. Not only in a
   code comment, and not in `PLAN.md` once its phase is closed. Write the entry as the
   state of the code, not the story of how it was found (`CLAUDE.md` → "Write down the
   present, not the past").

## Index

In payoff order: the first row is the next item.

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F12 | The tools' scaffolding is copied, and reaches privates through unchecked casts | L | ⏳ step 3 of 6 |
| F3 | Phase 15 step 4 | — | in `PLAN.md` |
| E15 | The page shell | L | ⏳ with the page redesign |
| G29 | Recording a game and playing it back | — | ⏸️ |
| C145 | The Hint Oracle's title boxes keep colour 12 on their last line and a half | S | ⏸️ waits on the author |
| C150 | Conflux's "Jitter" DSA can pass an overlay jitter, where CSBWin's source stops | S | ⏸️ waits on the author |
| G21 | `Translation.txt`: the messages the executable prints, translated | — | ⏸️ |
| G22 | An unknown dungeon played from its save | — | ⏸️ |
| G30 | 3D2D1D's vertical moves and gravity | L | ⏸️ |
| X1 | Extra: drinking from a fountain with an empty hand | S | ⏸️ |
| X2 | Extra: a mastery just gained shown in green | S | ⏸️ |
| X3 | Extra: thrown weapons gathered back when the party walks over them | M | ⏸️ |
| X8 | Extra: RISE's own dialog, and the utility disk's portraits on DM's champions | M | ⏸️ |
| H | Deliberate divergences | — | 🚫 |

The rows above G29 are the active list. `F3` is a phase, whose
status is `PLAN.md`'s, and its row only marks its place. One row sits
out of its tier's place on purpose: `E15` below the G rows, because it waits for the page
redesign to start: a session that reaches it first asks the author, and takes the next
row meanwhile. The F
rows are independent of the rest ("Priority", point 4), so they can be taken anywhere.
The ⏸️ rows are postponed (see "Priority") and are never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C163 · D17 · E22 · F14 · G31 · X9. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## D — State representation

New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

New architecture debt goes here, and jumps the queue. Every E item is a refactor: the rules
of "How to work this list", point 3, apply, byte-identical tool output included.

### E15 ⏳ The page shell

What the redesign will replace, and what it should not carry across:

- **Settings live in the DOM.** `readUISettings` reads each panel's `style.display` back
  to know what to save (`src/ui/settings.ts`), and the element lookups are written twice
  (`events.ts:11-21`, `settings.ts:63-75`). A `UIContext` module singleton
  (`src/ui/context.ts`) is how the panels reach the game.
- **`main.ts` holds the page's features**: the 100-line CRT controller (`:42-150`) and
  the end-of-game flow.
- **`static/` holds files nothing loads**: `static/glfx.js` and
  `static/glfx-latest-minified.js` (the page loads `src/lib/`'s copy),
  `QPN59-1400x1000.png` and `QPN59-320x200-cropped.png`. It is the dev server's
  `publicDir` only, so a build ships none of them (`vite.config.mts`).

Paying it is the redesign's first step: settings as a model the page renders, the CRT in a
module of its own, and a `static/` holding only what the dev server needs.
The redesigned page also links to two pages:

- **A static FAQ.** Among its answers is one paragraph on the statistics the server
  collects (`doc/STATISTICS.md`), and why:
  - to check that the game is actually played;
  - a leaderboard of the preferred champions;
  - where parties die most often.

  It insists that the statistics are anonymous: no player's name, no IP address, no
  browser profiling. A random id, drawn in the browser, is used only for counting
  players. Champions go by the names they carry, which a player can type.
- **The public statistics**, drawn from the server's `api/stats`.

---

## C — Known divergences from CSBWin

A divergence found along the way goes here, with the next free ID.

### C145 ⏸️ The Hint Oracle's title boxes keep colour 12 on their last line and a half

Not a divergence yet: the port draws what CSBWin draws. Recorded because it looks like a
bug of the original that the port might fix, under `CLAUDE.md` → "The one
non-negotiable rule", once the author has seen it in play (the inventory's Oracle
button makes it reachable, in the `csb` set) and judged whether it is worth it.

Once a title list is up, each title line goes through `TAG0062a2` with `byte16528`,
colour 12 to 9 (`doc/CSBwin-src/Hint.cpp:5513-5530`). Slot 9 is the one the title list
cycles through shades of red, so the line's background and its frame pulse together.
`TAG0062a2` copies the rectangle with `TAG0088b8`'s lines, `(w + 16) / 16` sixteen-pixel
groups for `w + 1` pixels, but passes `ShrinkBLT` `w` by `h`, whose lines are
`(w + 15) / 16` groups. On a title line (x 40-280, y 13 lines) the remap covers 240 by
12 pixels over lines of 256: the first eleven lines whole, 64 pixels of the twelfth, and
none of the thirteenth. While the cycle runs, the bottom of each box stays `0x310`
(`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "The title list"; `HintOracleScreen.tag0062a2`,
`src/renderer/intro/HintOracle.ts`). `tools/dump-hint-oracle-screen.ts` asserts the notch.

The arithmetic is consistent in the C++, so it is most likely `HINT.FTL`'s own rather
than a slip of CSBWin's translation. Passing `ShrinkBLT` `w + 1` by `h + 1` would remap
the whole line. Its lines would then be the copy's own, `(w + 16) / 16` groups.

The decision is the author's, after a look in play:

- **Keep it** (CSBWin's picture): delete this entry; the reference doc already says why.
- **Fix it**: `ShrinkBLT` gets `w + 1` by `h + 1`, the tool's check of the twelfth line
  becomes "every line holds no colour 12", and an H entry gives both readings.

### C150 ⏸️ Conflux's "Jitter" DSA can pass an overlay jitter, where CSBWin's source stops

Not a divergence yet: the port does what CSBWin's source does. Recorded because only play
can tell whether the binary the author plays, CSBWin 20230608, does what its source says.

Conflux 3.5 calls `&JITTER` seven times. It pops `yOverlay`, `xOverlay`, `yGraphic` and
`xGraphic` (`doc/CSBwin-src/DSA.cpp:4904-4931`), and six of the calls push 0 for both
overlay values. The seventh, DSA 125 ("Jitter S0: P1x, P2y, P3 ticks …"), state 0 and 1,
action 7, pushes its variables 0 and 1 and `&OVER`s them both, so the overlay jitter is the
graphic jitter. Four actuators select DSA 125: level 29 (15,16), and level 39 (30,16),
(31,16) and (31,17). Whether a message reaches its action 7 in play is not traced.

With the overlay up and `xOverlayJitter` other than 0, `UpdateViewportArea` stops in
`NotImplemented`, the game's end (`doc/CSBwin-src/WinScreen.cpp:1121-1196`), and so does
the port (`UpdateViewportArea`, `src/renderer/csbwin/OverlayScreen.ts`); `yOverlayJitter`
is read nowhere. The 2016 source is the same at both places, so every build stops there
unless the binary was not built from its source. Paying it: the author plays those squares
in CSBWin 20230608, and if the game goes on there, ports what that binary draws.

---

## F — Verification debt

### F3 — Phase 15 step 4 stays in `PLAN.md`

The table-extraction round-trip checks are a live phase, so they stay in `PLAN.md` →
"Phase 15" rather than being copied here. The never-executed validation steps of phases 2,
4 and 7 are folded into it. Step 5, the comparison against CSBWin screenshots, is postponed
(see "Priority").

### F12 ⏳ The tools' scaffolding is copied, and reaches privates through unchecked casts

`tools/lib/game.ts` gives every tool the same `Game` and tables (`E1a`). What each tool
builds around them is its own:

- 40 tools spell out `addCharacterDefaults()`, most inside a champion-building function
  of their own; 145 construct a `DungeonLoader`, most to read `dm-atari/dungeon.dat`.
- 6 tools stand in for an engine call the UI makes by assigning over the system's method
  (`executeAttack`, `castSpellFromUi`, `consumeAttackDamageToDisplay`,
  `reincarnateNamed`), which nothing types as a stand-in or puts back. Two more hang a
  stand-in on `Game` itself: `dump-hall-of-champions` stores its messages in a property
  `Game` does not have, and `dump-game-events` replaces `reincarnating`. 31 tools extract
  the UI tables again (`graphicsTablesOf(…).ui`) beside the `UIState` that
  `tools/lib/ui.ts` builds them into.
- 24 tools make 39 `as unknown as` casts, into the systems' private members
  (`MonsterSystem`'s `loadedLevel`, `CSBGraphicsLoader`'s `opened`) or to build a partial record; 4 more
  tools cast through `as any`, three of them into privates (`getMissileRecord`,
  `resolveStdRectanglePointer`, `MissileEncounter`'s). `tsc` checks none of them. A renamed member leaves the tool
  compiling, and a write to it then sets a new property: the tool goes on passing while
  testing nothing.

Paid in six steps, each tool's whole output byte-identical across every commit
("How to work this list", point 3). Steps 1 and 2 are done: `Game`'s seam for the tools
is public, `gameTick` and `lastInputTime` beside `runFrame`, and no tool casts into
`Game`; every `UIState` a tool drives is `newUIState`'s (`tools/lib/ui.ts`), whose
context a tool stages by assigning its fields.

3. **Other systems' privates.** Each private a tool drives either becomes public, with
   the reason in its comment, or the tool reaches it through the public path the engine
   uses. One system per commit. `DsaSystem`, `TimerSystem`, `ActuatorSystem`,
   `MagicSystem`, `WorldMove`, `AttackSystem` and `MonsterAI` are done. Left:
   `MonsterSystem` (`loadedLevel`), `MissileEncounter`, `BytecodeInterpreter`, and
   `CSBGraphicsLoader`'s `opened` (`dump-dsa-overlay`).
4. **The stand-ins**: a `tools/lib` helper that replaces a member with a typed stand-in
   and puts it back, for the six method stand-ins and `Game`'s two. One commit.
5. **The stock dungeon and a test champion** as `tools/lib` helpers, and the tools moved
   to them, a few tools per commit.
6. **What is left**: every remaining cast either goes, or builds a stand-in value the
   tool cannot type otherwise (a partial record, a fake `ImageData`), with a comment that
   says so. The item is paid when no tool reaches a private through a cast and no `as any`
   is left.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. The active ones come in the index's order; the
postponed ones follow, under their own heading (see "Priority").

### Postponed until the default dungeon is validated

Not taken in order; the author names one to start it (see "Priority").

### G21 ⏸️ `Translation.txt`: the messages the executable prints, translated

The messages the executable prints are string literals in CSBWin: " MUMBLES A MEANINGLESS
SPELL.", " RESURRECTED", "HEALTH", the skill titles, the menus. `ReadTranslationFile` reads
`Translation.txt` from the game directory: one pair of quoted strings a line, English then
translation, and `//` comment lines (`doc/CSBwin-src/Translation.cpp:131-176`, called at
`CSBUI.cpp:927`). `TranslateLanguage` swaps a literal for its pair, and returns it unchanged
when it has none. The port prints the English literals, so the French 1.3 set
(`dm-atari-1.3-fr`) plays with French objects, scrolls and walls, and English messages.

CSBWin translates at about a hundred call sites: `QuePrintLines`'s `translate` argument
(" JUST GAINED A ", `Magic.cpp:178`), the level gain, the menu titles (`Menu.cpp`), the
inventory's labels and object descriptions, scrolls and floor texts, and wall texts in
their 5-bit code (`TranslateWallLanguage`, `doc/CSBwin-src/Translation.cpp`). It reads the
file into a table hashed on the first two characters.

A French file exists: `TranslationFrench.txt` on dianneandpaul.net/CSBwin/ (2018, 201
lines, UTF-8 with a BOM, no accents since the font has none). It is a player's work in
progress, not the French Atari program's own strings: its comments mark which lines were
seen working ("good"), which were never seen, and which do not match the English key
("no good", with a corrected line below). Its words are its translator's ("PRIEST" is
"MAGE", "WIZARD" "DRUIDE"), and the author, a native speaker, disagrees with some of them,
those two first. The author reviews the file before it ships.

The French 1.3 program's own strings are the faithful source where they exist. The disk
image is `archive/DungeonMaster1v3Fr.stx` (gitignored; `doc/ATARI_ST_DISK_REFERENCE.md`
→ "The French 1.3 disk"). The program is presumably `START.PAK`, packed and not yet
examined, whose 1.3 differs from 1.2's, so it must be unpacked before its strings can be
read. It holds only what the 1988 program printed: the CSBWin-only messages (the save
dialog's file menus, DSA texts, the utility, the Hint Oracle) have no French original and
come from the file above or from the author. Some French words are not strings at all,
but pictures in `graphics.dat` already drawn in French (RESSUSCITER / RÉINCARNER /
ANNULER, NOURRITURE, EAU).

Paying it: port `ReadTranslationFile` and `TranslateLanguage`, read the file from the data
set's folder (a manifest field, as `hintOracle` is), and put `TranslateLanguage` at 2023's
call sites. Then a `Translation.txt` for `dm-atari-1.3-fr`: the program's strings first,
the file above for the rest, reviewed by the author. And a golden frame of a translated
message.

### G22 ⏸️ An unknown dungeon played from its save

CSBWin resumes any save its directory holds, with that directory's `graphics.dat`. The
port's import refuses a save of a dungeon it does not know, and of a known one no data
set plays (`doc/SAVES.md` → "An import is checked against the dungeon"). Playing one
would be a further answer on that refusal, of use to someone working on a dungeon of
their own. A save is its dungeon's whole world and already loads into any running game
(`installCsbwinWorld`), so what is missing is what the file does not hold: the graphics
and the tables read from `graphics.dat`, which the player would pick from the known
dungeons' (the signatures an Extended Features block may carry,
`doc/CSBwin-src/SaveGame.cpp:380-381`, could suggest one); a `dungeon.dat` for "RESTART
THIS GAME", so a lost game can only load a save; and a data set to list its saves under,
which its signature can stand for.

### G29 ⏸️ Recording a game and playing it back

CSBWin can record a game and play it back:

- **The recorder** (`RECORDFILE`, `doc/CSBwin-src/Recording.cpp:864-1300`) is the
  "Record" menu item (`CSBUI.cpp:966-979`). It writes `logs/RecordNNNNN.log`: a version
  line, `#` option lines (`#DMRules`, `#ExtraTicks`, …), then one line per input event,
  `time x y num random` in hex (`Recording.cpp:1265`). The `d.RandomNumber` on each line
  is what shows that a playback has drifted. A click in the viewport is recorded by
  `HandleClickInViewport` (`Mouse.cpp:1032`) with fewer coordinates, and every other entry
  of the mouse queue by `_HandleMouseEvents` (`:1634-1645`).
- **The player** (`PLAYFILE`, `Recording.cpp:152-849`) is the "Playback" menu item
  (`CSBUI.cpp:980-987`), which turns `extraTicks` off. It reads `Playfile.log` and feeds
  its events into the mouse queue at their ticks. It does so from the top of
  `_HandleMouseEvents` (`Mouse.cpp:1494`), except while gravity runs.

Conflux 3.5's Extended Features block sets `AutoRecord` (0x10), `RecordDesignOption`
(`doc/CSBwin-src/SaveGame.cpp:403-404`): a game read from it records unless the command
line or the menu says not to (`:2588-2603`). The port has neither, and no way to start either. It keeps only the recorder's count,
`totalMoveCount`, which a save stores (`Game.recordFileRecord`, `src/engine/Game.ts:873-876`).
`extraTicks` is always on (`src/engine/MovementSystem.ts:119-122`).

Once ported, a recording made in CSBWin and played back in the port is an end-to-end test
of everything at once, and the first line whose `random` differs points at the first
divergence. That needs the port's random numbers to follow CSBWin's draw for draw. A
recording cannot be written by hand, nor by a solver such as `tools/solve-3d2d1d.ts`:
every line needs its exact tick and random state.

### G30 ⏸️ 3D2D1D's vertical moves and gravity

`doc/3D2D1D.md` has the whole account. The 3D2D1D dungeon (data set `3d2d1d`) loads but
cannot be played as designed. It needs two CSBWin features the port has not ported,
behind `bThreeDMovements` and `bGravityGame`, which start `false`
(`doc/CSBwin-src/data.cpp:240-241`).

CSBWin sets them from `efb.extendedFlags` bits `0x400` and `0x200`
(`doc/CSBwin-src/SaveGame.cpp:427-430`), as the 2019 `CSBwin.exe` shipped with
the dungeon does, and so does the port: `bThreeDMovements` and `bGravityGame` in
`ctx.rules` (`readRulesOptions`, `src/data/CsbwinExtendedFeatures.ts`), which a save
writes back (H → "A save keeps the dungeon's three 2023 flags"). Nothing reads them yet.
Everything else is in CSBWin's source.

The gate is the dungeon, as in CSBWin: no other dungeon here sets either bit, so DM and
CSB are unchanged, and the keys cannot be used to cheat there.

Two steps:

1. **Vertical moves** (M). Bind the PC keys `-` and
   `=` (`KeyboardEvent.code` `Minus` and `Equal`, scancodes `0x0c`/`0x0d` in
   `config.txt`) to keyscans `0x4900`/`0x4a00`. Queue them as buttons
   `0x1124`/`0x1125` when `bThreeDMovements` is set (`TAG0196da`,
   `doc/CSBwin-src/CSBCode.cpp:8575-8595`). Hand those two buttons to the move in
   `Game.handleMouseEvents` (`Mouse.cpp:1695-1709`). Then port `MoveParty`'s
   `direction > 3` arm (`CSBCode.cpp:8255-8377`) into `MovementSystem`: the pit rule,
   `TraverseStairway(direction-4, false)`, and the wall bump.
2. **Gravity** (M). `moveHistory`, `gravityMove` and `nextGravityMoveTime`, updated in
   `MoveParty` (`CSBCode.cpp:8128-8170`). `GravityMove` (`Mouse.cpp:1259-1370`) and its
   hook at the head of `_HandleMouseEvents` (`:1482-1491`), which empties the queue while
   gravity runs. CSBWin does not save the three variables (`data.cpp:246-248`), so
   neither does the port. Two consequences, both CSBWin's own:

   - **No save during a slide.** While `gravityMove` is set, `_HandleMouseEvents` empties
     the queue each pass (`Mouse.cpp:1606-1625`), so the disk icon's click is lost and
     CSBWin saves only at rest. The port's F5 does not go through the queue (`GameInput`,
     `src/renderer/GameInput.ts`), so it must refuse during a slide: "CANNOT SAVE NOW", as
     for a script holding the loop (`doc/SAVES.md` → "The two keys"). The Sleepsave comes
     from a click, so the queue drops it as it drops the disk icon's.
   - **The axis history is lost.** `moveHistory` holds the order of the last three axes
     moved and the direction last moved along each (`MoveParty`,
     `CSBCode.cpp:8215-8250`). `GravityMove` tries the axes in that order
     (`Mouse.cpp:1261-1301`). It is initialised once, `{0,1,2,0}`, and never on a load, so
     CSBWin starts from its default after a restart, or from the last game's history
     after a load. The first slide after a load may take another way than it would have.
     Three moves of the player's, one along each axis, restore it. The port starts every
     loaded game from `{0,1,2,0}`, CSBWin's state after a restart. The 3D2D1D route tool
     checks that the dungeon is still solvable from a save at each point of the route.

A `watch-*.ts` proves each step on the real 3D2D1D files: up and down through map 1's
fake pits, a refused move into stone with its damage, and a gravity slide ending where
`GravityMove` finds no axis. 3D2D1D's six DSAs use only MESSAGE, OVERRIDE,
COPYTELEPORTER and GOSUB, and it has no party-move filter. A hand probe ran the 1D
corridor's chain correctly in the engine (`doc/3D2D1D.md`), but no tool proves it yet.
`static/gamefiles/3D2D1D/WALKTHROUGH.md` is a full route computed from CSBWin's rules
by `tools/solve-3d2d1d.ts`, outside the engine. Once both steps are in, a tool that
replays it through `Game` is the end-to-end proof.

---

## X — Extras (not in CSBWin)

Features from later versions of the game or from elsewhere, which the author wants once
the default dungeon is validated. Postponed (⏸️) like the G items below "Postponed", and
taken only when the author names one.

Rules for all of them:

- **One setting, off by default**: `UISettings.extras` (`src/ui/settings.ts`), the page's
  Extras button, which they all share. With it off, the game is CSBWin's: every
  tool's output and every golden frame stay the same. The FTL logo before the title
  (`src/renderer/intro/Swoosh.ts`) is behind it. The coloured object cursor is the
  exception: the author wants it on by default, so it is recorded under H.
- **None of them is saved.** What an extra keeps in memory is lost on a save and a load,
  in the port's runtime save as in a CSBWin file, and that is acceptable: no save format
  changes.
- **Each ships with its `tools/` check**, run with the setting on, and its entry here is
  deleted as for any paid item.

### X1 ⏸️ Drinking from a fountain with an empty hand

CSBWin's fountain is a wall decoration, not an actuator: the renderer sets
`d.FacingWaterFountain` when the decoration in front is `d.Word4040[0]`
(`doc/CSBwin-src/CSBCode.cpp:3363-3369`), and a click on viewport button 5 with it set
fills a waterskin or an empty flask held in the cursor, and does nothing else
(`doc/CSBwin-src/Mouse.cpp:1195-1226`). The port has the same thing in
`tryUseFrontWallItem` (`src/renderer/ui/ViewportPicking.ts:138`), which returns at once
when the hand is empty.

The extra: with an empty hand, the **cursor owner** drinks. That is the same drink as one
gulp from a full waterskin: `waterValue = 800` and `SOUND_GULP` (`computeFeedParameters`,
`src/renderer/ui/Feeding.ts:60-69`), applied through `applyFeedParameters`, so the water cap
and the sound are CSBWin's own. A dead or absent cursor owner drinks nothing.

### X2 ⏸️ A mastery just gained shown in green

A level gain raises attribute **maximums** only (`IncrMaximum`, `src/engine/skills.ts:350`
onwards), and the current values climb to them over time. Meanwhile the attribute panel
already prints those values in red (`drawAttributePanel`,
`src/renderer/ui/Character.ts:104-107`). The mastery lines above them are always drawn in
colour 13 (`:80-88`).

The extra: when a role's mastery rises, remember, per champion and per role, which
attributes that level gain raised. Draw the role's line in colour 7 (the green the panel
already uses for an attribute above its maximum) until every one of them has reached its
new maximum again. The panel cannot work this out on its own, because a drop below the
maximum from a level gain looks the same as one from damage or a potion. The check can
run when the panel is drawn. Lost on a save, the line just goes back to colour 13.

### X3 ⏸️ Thrown weapons gathered back when the party walks over them

An idea from *Legend of Grimrock*. Only a weapon thrown by an **attack action** is
gathered back, never one thrown from the cursor:

- **THROW** (`atk_THROW`, `src/engine/AttackSystem.ts:1482`) throws the weapon-hand object,
  slot 1, through `MouseSystem.throwFromWeaponHand` (`src/engine/MouseSystem.ts:43`).
- **SHOOT** (`attackWithShoot`, `src/engine/AttackSystem.ts:1580`) fires the ammunition
  held in slot 0 through `MagicSystem.launchObject` (`src/engine/MagicSystem.ts:572`).
  `launchObject` also launches spells, so the object is tagged in the attack, not there.

A thrown object keeps its `ObjectID` all the way: in the missile's `projectileObject`,
on the floor where it lands, and in a monster's possessions when a hit absorbs it
(`MissileEncounter.ts:444`), which the monster drops when it dies. So a tag table
`ObjectID → { champion, slot }`, filled at the throw, follows it without any further
work.

Needed:

- **The trigger.** When the party arrives on a cell, after that cell's actuators have
  fired, take every tagged object lying there. Arrival covers the stairs, pits and
  teleporters (`src/engine/WorldMove.ts`) as well as a step.
- **Taking it the proper way.** The object comes off the floor through the same
  remove-from-cell path as a pickup by hand, so a pressure plate under it still fires.
- **Putting it back.** Into the slot it left if that is empty and the object's carry
  mask allows it there (`objDescWord4`). Otherwise into the first free slot that
  allows it (quiver, then pack). The load is recomputed from the possessions (H). If the
  thrower is dead or has no room, the object stays on the floor, keeping its tag.
- **Dropping tags.** A tag goes when the object is picked up by hand, and when its
  record is freed (`deleteDBEntry`, `SmartDiscard`, `MakeMoreRoomInDB`). A freed record
  handed out again must not inherit it. Every writer of `objectInHand` and every caller
  of `deleteDBEntry` is found by grep, as for any empty value (`CLAUDE.md` → "Object IDs").

A `watch-*.ts` tool proves it: throw and shoot at a wall and at a monster, kill the
monster, walk onto the cell, and check the inventory, the floor chain and the load.

### X8 ⏸️ RISE's own dialog, and the utility disk's portraits on DM's champions

RISE (`src/renderer/intro/PrisonDoor.ts`, `doc/SAVES.md` → "RISE makes a save of its own")
is CSBWin's UTILITY → "MAKE NEW ADVENTURE". The original utility could also give a
champion one of 24 redrawn portraits of DM's champions, the `.CMP` files of its disk's
`PORTRAIT\` folder. That was the champion editor's LOAD → PORTRAIT, by hand, one champion at
a time (`doc/ATARI_ST_DISK_REFERENCE.md` → "The Chaos Strikes Back utility disk"). CSBWin
does not port the editor, and the port will not: the 68000 binary is its only source. The
extra does the editor's work for the player: a DM champion raised into CSB gets the
redrawn portrait of the champion they are.

The X rules' setting does not apply. RISE is the port's own, and the author wants the
upgrade on by default, so it is a checkbox in RISE's dialog, checked whenever the dialog
opens, not `UISettings.extras`. Unchecked, RISE makes CSBWin's adventure byte for byte, as
it does now. The upgrade is saved: the portraits are in the new file, in CSBWin's own
`CHARDESC` field, so CSBWin shows them too.

Two steps, one commit each:

1. **The dialog.** RISE opens `SaveMenu` in its `rise` mode
   (`src/renderer/ui/SaveMenu.ts`): the load-only chooser over every data set's saves.
   Nothing in it says what RISE does, and it offers EXPORT whenever a save is selected
   (`canExport` does not look at the mode), though exporting has nothing to do with raising
   a party. In `rise` mode: no EXPORT, and a text saying what LOAD does. It makes a new
   Chaos Strikes Back adventure with the chosen save's party, a finished DM game's or the
   prison's. The adventure is stored as a new save (`-csb`), and the source is left as it
   is. Where the text goes (the title panel, or the preview panel before a save is chosen),
   and whether LOAD's label should name the action, are the author's to decide before this
   is taken. `tools/dump-save-menu.ts` checks the mode, and so do the golden frames if one
   shows the dialog.
2. **The portraits.**
   - **The data.** `static/gamefiles/csb/utility-portraits.dat`
     (`tools/gen-utility-portraits.ts`) is a `graphics.dat` whose item 0 is laid out like
     DM's graphic 26. Cell `charID` is the redrawn face of the champion whose DM portrait
     is cell `charID`. The page reads it with `GraphicsLoader` from the running set's
     folder, beside `mini.dat` (`readMiniDat`, `src/main.ts`). A set without the file
     shows no checkbox.
   - **Which champion: by portrait, never by name.** REINCARNATE lets the player give
     a champion a new name and title, so a name proves nothing. A champion's portrait
     is a cell of DM's graphic 26, pixel for pixel (`tools/dump-csbwin-load.ts`). The
     champion whose decoded portrait (`readCsbwinCharacter`) is exactly cell `charID`
     gets cell `charID` of the new file. A champion that matches no cell keeps their
     portrait: the prison's champions, whose faces are CSB's own graphic 26, and any
     portrait drawn in an editor. The reference is DM's graphic 26 from
     `dm-atari/graphics.dat`, not the source save's set. It is byte-identical in every DM
     set and in `kids-dungeon-24`, but `3D2D1D` and Conflux have their own faces in those
     cells.
   - **Where.** On the source's `CHARDESC`s, with `writePortrait`, before `TAG002724`
     copies them into `mini.dat` (`makeNewAdventure`, `src/engine/Chaos.ts`). That is
     where the utility's `TAG00439e` swaps the editor's portraits in
     (`doc/CSBwin-src/Chaos.cpp:4632-4656`), so the portraits are what the original
     writes after a LOAD → PORTRAIT of each champion's `.CMP`. Names and titles are never
     touched, whatever the `.CMP` holds: the author's rule (what the original editor does
     to them is not established). `Chaos.ts` stays CSBWin's: the portraits come in as an
     argument, and `GameSaves.makeNewAdventure` passes them only when the box is
     checked.
   - **The checkbox.** In `rise` mode only, checked whenever the dialog opens. For
     example, a two-state button in the EXPORT frame that step 1 frees, reading UPGRADE
     PORTRAITS or KEEP PORTRAITS; its look is the author's call. The prison's "BEGIN THE
     ADVENTURE?" (`askBeginAdventure`) needs none: its party is the prison's, whose faces
     match no DM cell.

   The check, in `tools/dump-rise.ts`:
   - **`csbgame7.dat`, checked:** every champion has the new file's cell for their DM
     portrait, with the same name and title; every other byte matches the unchecked
     adventure.
   - **`csbgame7.dat`, unchecked:** the same bytes as now.
   - **`csbgame-early-2hero-renamed.dat`:** the renamed champion is upgraded by portrait,
     and keeps their new name.
   - **The prison's four:** their portraits are unchanged either way.

   `doc/SAVES.md`'s RISE paragraph then describes the checkbox.

---

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

- 🚫 **A save keeps the dungeon's three 2023 flags.** CSBWin 20230608 reads
  `SupressDSAWarning` 0x100, `GravityGame` 0x200 and `ThreeDMovements` 0x400 from a file's
  `extendedFlags` into `SupressDSAWarningOption`, `bGravityGame` and `bThreeDMovements`
  (`doc/CSBwin-src/SaveGame.cpp:415-416`, `:427-430`), and its `SaveGame` writes
  none of them back (`:955-993`); the utility's `mini.dat` writes only the first
  (`Chaos.cpp:2168-2171`). So a 3D2D1D game saved in CSBWin reloads with neither the
  vertical moves nor gravity, and cannot be finished, and a dungeon that stops the
  "Excessive DSA operations" warning gives it again after a load. The flags are the
  dungeon's rules, which every other flag of the block carries through a save
  (`DMRules`, `InvisibleMonsters`, `ExtendedWallDecorations`). The port writes all three as
  the last file read gave them (`buildLiveExtendedFeatures`,
  `src/data/CsbwinExtendedFeatures.ts`), and a CSBWin 20230608 reads them back.
  `tools/dump-extended-dungeon.ts` checks that a 3D2D1D save keeps both of its own. 3D2D1D
  is the only dungeon here that sets any of them.
- 🚫 **The canvas shows an Atari intensity times 36, not RGB555.** CSBWin hands Windows
  RGB555 pixels, its straight palette each intensity `i` as five bits `(i << 2) | (i >> 1)`
  (`CreateOverlayTable`, `doc/CSBwin-src/Graphics.cpp:3096-3117`), which Windows widens to
  8 bits as `(v << 3) | (v >> 2)`: intensities 0-7 show as 0 33 74 107 148 181 222 255.
  The port's canvas shows them as `i * 36`, 0 36 72 108 144 180 216 252
  (`atariIntensity`, `src/renderer/csbwin/CanvasBlitter.ts`, and `atariToRGB`,
  `src/core/types.ts`), up to 6 a channel apart, and the golden frames are taken so. Only
  the viewport through an overlay, a tint or a jitter is CSBWin's RGB555 widened
  (`src/renderer/csbwin/OverlayScreen.ts`), so while one is up the viewport and the panels
  show the same Atari colour up to 6 a channel apart. `tools/dump-overlay-screen.ts` prints
  both. To revisit when frames are compared with CSBWin's (`PLAN.md` → Phase 15, step 5):
  RGB555 on every screen would move every golden frame once.
- 🚫 **An object in hand keeps its colours over the dungeon view** (X4). CSBWin draws the
  cursor rows from screen row 29 down as the object's colour-4 silhouette while the view
  is shown (`doc/PROVEN_FACTS.md` → "An object in hand is a colour-4 silhouette over the
  dungeon view"). The port draws the icon itself and shows those pixels through the
  interface palette, so neither the light nor the level's monster colours reach it
  (`drawCursorItem`, `src/renderer/ui/Mouse.ts`, and `GameScreen.presentViewport`). The
  arrow over the right-hand panel and the message area is kept. It is
  `UIState.colouredObjectCursor`, on by default. It becomes a `UISettings` toggle once the
  port has a settings menu; `tools/dump-object-cursor.ts` checks it both ways.
- 🚫 **The right-hand panel is shown through the interface palette.** With
  `d.DynamicPaletteSwitching`, CSBWin converts the spell, weapon and movement panel,
  x 224-319 by rows 33-168, through the viewport's `d.Palette11946`, as it does the
  viewport (`doc/CSBwin-src/WinScreen.cpp:1493-1496`, `:1510-1566`). The port uses the
  interface palette there. Nothing drawn in that band while the view is shown has a colour
  but 0 and 4: graphics 9, 10, 11 and 14, the text, the arrow and hand cursors, and
  `vblFlashButn`'s XOR with 4. Those are `000` and `066` in every palette, so with the DM
  graphics the two cannot differ on screen, and the golden frames stay as they are.
- 🚫 **The mirrored far-right sidewalls' `srcOffsetX`.** CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for positions 1 and 6
  (`doc/CSBwin-src/CSBCode.cpp:3603`), compensates for `MakeMirror` reversing a
  byte-aligned buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would
  shift a correctly aligned image. The reasoning is in the code.
- 🚫 **`MakeBigActuators` reads the actuator's type, not CSBWin's byte-order slip.** CSBWin
  converts the actuators of a file without the `BigActuators` flag before their byte swap
  (`doc/CSBwin-src/SaveGame.cpp:2813-2820`), so it takes bits 8-14 of `word2` for the
  type where the port takes the type itself (`doc/PROVEN_FACTS.md` → "`MakeBigActuators`
  runs before the byte swap"). The two differ only for a type-47 actuator under either
  reading: DM has none, Conflux's file has the flag, and `tools/dump-dungeon-conversions.ts`
  fails for a dungeon that has one.
- 🚫 **A kill of `alternateGraphics` 4 to 7 is counted nowhere.** `ProcessMonsterDeleteFilter`
  indexes the kill statistics' four longwords with the three-bit subtype unchecked
  (`doc/CSBwin-src/Code11f52.cpp:990`, `:995`): a new record's count goes into the stack past
  its array, an existing one's into the pool past the record. The port writes the record
  of zeros and raises no count (`MonsterDamage.processMonsterDeleteFilter`).
- 🚫 **`CHARDESC.load` is recomputed** from the possessions, rather than cached and adjusted
  at each of CSBWin's eight possession writers. Same value, and it cannot drift. `Party.ts`
  made the same choice for `SetHandOwner`. Recorded in the module comment of
  `src/engine/CharacterStats.ts`.
- 🚫 **`_FlashAttackDamage` does not stop the game, and lasts two ticks.** CSBWin's ends in
  `VBLDelay(15)`, which halts everything for a quarter of a second, and the tick due by
  then draws the buttons over the damage (`doc/CSBwin-src/Attack.cpp:1039`,
  `CSBCode.cpp:8950-8958`). The port shows the flash as a timed overlay while the game
  keeps running, as it already does for the feeding animation. The author's decision is
  400 ms (`FLASH_MS`, `src/renderer/ui/Attack.ts`), over one tick and under two, so the
  text can be read: the damage is up for two ticks, half a second, where CSBWin's is up
  for one. The keys still open an attack menu over it. `tools/dump-attack-panel.ts`
  checks that the first tick after the flash leaves it up.
- 🚫 **Three inputs bypass the mouse queue:** the save menu and the Reincarnate screen,
  which are modal, and the panel keys in `src/renderer/ui/Keyboard.ts`, whose module
  comment gives the reason. So none of them reaches `totalMoveCount`: CSBWin's save menu
  counts its SAVE AND PLAY or CANCEL click, since `_WaitForMenuSelect` takes it through
  `HandleMouseEvents` (`doc/CSBwin-src/Menu.cpp:33-41`), and a file the port writes counts
  one move fewer than CSBWin's would. While a script holds the loop (`Game.isRunningScript`) the
  panel keys do nothing, where CSBWin's would wait in the queue for the first pass after
  the script. After the fusion that pass never comes before the credits. After
  `_MagicSelection`'s three VBLs it does, so a rune key typed within about 50 ms of the
  last is dropped; the author finds that acceptable, and `handleUIKey`'s comment has the
  two ways to keep such keys. The two screens open only from a pass, so neither is up
  while a script runs.
- 🚫 **F1-F4 select the caster.** CSBWin's adventure key table `Byte18400` binds them to
  buttons 7-10, the four inventories (`doc/PROVEN_FACTS.md` → "The key tables: CSBWin's own
  keys"). The author finds the caster on F1-F4 and the inventories on 7-0 more convenient,
  so `tableKeyButton` (`src/renderer/ui/Keyboard.ts`) leaves F1-F4 to `handleUIKey`. Every
  other table key keeps CSBWin's role. A rebinding screen, if players ever disagree, would
  make this a default rather than a divergence.
- 🚫 **The ending's speech is shown whole.** CSBWin runs the strip's clock at a tick, at
  the end of `PrintLines` and in `_ProcessTimersViewportAndSound`, and never in
  `_VBLDelay`. So in `_FusionSequence` each text gets one scroll in its thirteen seconds,
  and the credits come with most of the Grey Lord's speech, and "THE END.", never shown
  (`doc/PROVEN_FACTS.md` → "The Grey Lord's speech reaches the strip one row per text once
  the strip scrolls"). The author's decision: the port runs the clock on every VBL of the
  waits after a text and after "THE END." (`vblDelayPlacingText`,
  `src/engine/AttackSystem.ts`), so a row is placed in the VBL its scroll ends. Every text
  is whole within 24 VBLs of its `PrintLines` and stays until the next is printed, and
  "THE END." is on the strip when the credits come. The delays are CSBWin's: 780 VBLs a
  text, 600 after "THE END.", 4713 in all on the shipped dungeon. The reason: what CSBWin
  shows is a side effect of its making the strip a queue. `RemoveTimedOutText` and
  `PrintLines` still carry, commented out, the waits that held the caller until a scroll
  was over (`doc/CSBwin-src/CSBCode.cpp:1508-1512`, `:1699-1702`). That the Atari
  original, with those waits, showed every text is an inference, not a verified fact. No
  other script's wait runs the clock, and no other message is placed sooner than
  CSBWin's. `tools/dump-fusion.ts` checks it from a strip that has printed nothing and
  from one that has scrolled.
- 🚫 **A script's caller finishes at once.** `Game.runScript` returns as soon as the script
  reaches its first `VBLDelay`, so what CSBWin's suspended caller would do after the script
  ends, the port's does before it. The fusion and the CSB win's wait end the game, and the
  callers' tails that anything could still see are skipped (`executeAttack` and
  `handleAttackAreaClick`, `src/renderer/ui/Attack.ts`). `_MagicSelection`'s callers
  (`handleMagicClick`, `handleUIKey`) do nothing after it, and the rest of the pass it
  holds runs in the VBL the script ends (`Game.runFrame`). What is left is `HandleMouseEvents`' `lastTime = d.Time`
  (`doc/CSBwin-src/Mouse.cpp:1786-1788`), stamped at the click, which nothing reads after
  the credits.
- 🚫 **A champion carried into a new adventure keeps their sex.** `TAG002724` masks
  `charFlags` with `LE16(LE16(wordGear(+48) & 16))`, which on the little-endian build
  keeps 0x1000 of the file's word and clears `CHARFLAG_male`
  (`doc/CSBwin-src/Chaos.cpp:3392`). Nothing in CSBWin reads the flag, so it shows
  nowhere; the author's decision is to keep it all the same. The port keeps
  `CHARFLAG_male` and clears the rest, as the mask reads (`TAG002724`,
  `src/engine/Chaos.ts`; `tools/dump-new-adventure.ts`).
- 🚫 **A saved game the utility cannot read is damaged, not the program's end.** On a
  `GAMEBLOCK1` that opens only with word 10, CSBWin stops in `NotImplemented(0x1868)`
  (`doc/CSBwin-src/Chaos.cpp:2966-2999`); the port refuses it with message 14. No known
  file has that form (`doc/PROVEN_FACTS.md` → "Only the word-29 form reads").
- 🚫 **A `mini.dat` with an Extended Features block makes no adventure.** CSBWin's
  `_TAG000fc4` writes the new adventure a fresh block when `mini.dat` opened with one
  (`doc/CSBwin-src/Chaos.cpp:2141-2200`). The port refuses such a file (`TAG000fc4`,
  `src/engine/Chaos.ts`; `tools/dump-new-adventure.ts`). `mini.dat` is CSB's own, as on
  its disk, and no file with a block is known: only a dungeon editor could make one.
- 🚫 **A champion who dies in hand is put down on nobody.** `KillCharacter` does not end a
  change of the marching order, and `TAG0025a6` then writes the dead champion's facing and
  position to `d.CH16482[-1]`, outside the champions (`doc/PROVEN_FACTS.md` → "Changing
  the marching order"). The port writes them to no one and does the rest: whoever stood on
  the target square still moves (`tag0025a6`, `src/renderer/ui/Mouse.ts`).
- 🚫 **A fifth rune is refused.** `TAG01b990` writes the rune at `byte33`, then sets
  `byte33 = (byte33 + 1) & 3` (`doc/CSBwin-src/CSBCode.cpp:9090-9093`), so after four
  runes CSBWin's keypad shows the first row again and the next rune starts a new
  incantation over the old one. The author's decision: the port refuses any rune past the
  fourth, and the keypad keeps showing the fourth row (`tag01b990` and
  `drawSpellPanel`, `src/renderer/ui/MagicPanel.ts`). A save still carries `byte33` as
  CSBWin's writers leave it, `strlen(incantation) & 3` (`CsbwinCharacters.ts`).
- 🚫 **No caster tab without mana.** `DrawSpellControls` draws a tab for every champion
  whose `HP()` is not zero (`doc/CSBwin-src/Character.cpp:5019-5112`), and
  `_HandleMagicClick` picks among them (`Magic.cpp:599-702`). The author's decision: the
  port draws no tab for a champion whose maximum mana is zero, and neither a click nor a
  key selects one (`drawSpellControls` and `handleMagicClick`,
  `src/renderer/ui/MagicPanel.ts`; `selectCaster`, `src/renderer/ui/Keyboard.ts`). The tab
  appears once the champion's maximum mana rises above zero.
- 🚫 **A curse laid by a DSA moves the Luck of any bearer.** `SetCursed`, the DSA's
  `&CURSE!`, brackets the curse with `AdjustStatsForItemCarried`'s -1 and +1, but its
  search keeps the slot found only for the last champion and passes 30 for any other
  (`doc/PROVEN_FACTS.md` → "`AdjustStatsForItemCarried`"). There the curse costs no
  Luck, and taking the object off gives 3 Luck for good. The author's decision: the
  port passes the slot found, whoever the bearer (`setCursed`,
  `src/engine/DsaSystem.ts`), so a curse costs 3 Luck at once on every champion and the
  object taken off gives them back. No save format changes: the Luck a save carries is
  the attribute as it stands. `tools/dump-dsa-objects.ts` checks it.
- 🚫 **Word sizes from the file.** Two of CSBWin's constants are the English words'
  sizes: `AttackNames[300]` in graphic `0x230` and the source widths `DisplayFoodWater`
  blits the food, water and poisoned labels with. The French 1.3 `graphics.dat` has
  longer words in both places, so `parseGraphic230` sizes the names from the graphic's
  length and `drawFoodWaterPanel` reads each label at its own width. Every other set gets
  CSBWin's numbers (`doc/PROVEN_FACTS.md` → "The French 1.3 `graphics.dat`: longer
  words").
- 🚫 **The vertical-move guard** in `MoveParty` (`CSBCode.cpp:8287-8291`) is not ported,
  because nothing in the port reaches it. Move Up / Down (`0x1124` / `0x1125`) come only
  from the 3DMaze extension's `bThreeDMovements` keys and `GravityMove`, which G30 ports with
  the guard. CSBWin reaches it only in a dungeon whose Extended Features block sets
  `ThreeDMovements` (`doc/CSBwin-src/SaveGame.cpp:427-430`): 3D2D1D, here.
- 🚫 **The main loop makes one pass a VBL, not one a message.** CSBWin's loop makes a pass
  for every message the UI hands it (`doc/CSBwin-src/CSBUI.cpp:1274-1293`): each VBL's
  `UIM_VBL` (`system.cpp:624-630`), and a mouse button going down, which pushes a message
  of its own (`CSBUI.cpp:1206-1222`, `:1228-1243`). Every pass runs `HandleMouseEvents`,
  the tick if `d.clockTick` is set, and takes one print-queue entry (`CSBCode.cpp:724-775`).
  The port's `Game.runFrame` is one pass a VBL, and `onMouseClick` only queues: a click
  waits for the next VBL, at worst about 17 ms, and takes no print-queue entry of its own.
  The author's decision: the delay is too small to matter.
- 🚫 **`WaitForButtonFlash` does not hold the main loop's pass.** CSBWin's waits a VBL for
  the flashed rectangle to be put back (`doc/CSBwin-src/CSBCode.cpp:8666-8706`), and so
  does `_FlashButton` for it to be inverted (`:7800-7817`), while the port's pass never
  stops between VBLs. There, `flashButton` runs its VBL's share at once, so the rectangle
  is inverted where CSBWin's is, before the rest of the pass; `waitForButtonFlash` leaves
  the put-back to the next VBL (`src/engine/LoopState.ts`). Waiting there too would put
  the rectangle back before the frame is drawn, and no flash would ever be seen. At the
  main loop's two calls, which end a pass, this is CSBWin's order. A `RESTARTABLE` caller
  the port runs as a script waits as CSBWin does (`flashButtonScript`,
  `waitForButtonFlashScript`): `_MagicSelection`, and through it `CastMagic`'s call, and
  `_FusionSequence`. That leaves `TAG02076e`, which comes in a pass after the one that
  flashed, when the next VBL has already put the rectangle back.
- 🚫 **The intro and the end screen run on wall-clock time** through
  `requestAnimationFrame`, not on a VBL counter shared with the game loop. Nothing else
  runs while they play (the end screen starts once the loop has stopped), so there is
  nothing for them to drift against. If a boot-time animation ever has to agree with `d.Time`,
  this is the place that would have to change.
- 🚫 **The game does not quit.** `_ShowCredits` ends in `UI_PushMessage(UIM_TERMINATE)`
  (`doc/CSBwin-src/Code1f9e6.cpp:349`), which closes CSBWin. A page cannot close itself,
  so the credits picture stays up (`src/renderer/intro/ShowCredits.ts`).
- 🚫 **A damaged save at the boot goes back to the title.** There `tag01efee` prints
  "SAVED GAME DAMAGED!" and calls `die(0xbad)`, which ends CSBWin
  (`doc/CSBwin-src/SaveGame.cpp:2117-2118`). A page cannot end itself, so the author's
  decision is a one-button menu with the line and OK, whose click goes back to the title
  animation (`tag01efee` and `runBootSequence`, `src/renderer/intro/BootSequence.ts`).
  After a lost game `tag01efee` is CSBWin's own.
- 🚫 **A game file refused ends the game.** CSBWin dies on a `graphics.dat` or
  `CSBgraphics.dat` it cannot find or whose signature is not the one the game names
  (`doc/PROVEN_FACTS.md` → "The graphics files' signatures"), and on a `dungeon.dat` that
  will not open. Its message box is the executable's; the author's decision is that the
  page uses nothing more of the file and ends its game on a screen of its own: the
  message, white on black, in a browser font of 12pt or more, in the canvas's place
  (`showFatalMessage`, `src/ui/fatalMessage.ts`), where the player decides what to do. So
  does every error that ends the page's game. Two cases die here where CSBWin does not:
  a data set's `CSBgraphics.dat` that does not load or parse, which CSBWin would meet
  only at a read; and a `dungeon.dat` that does not read, which CSBWin's `tag01efee`
  takes as a damaged save (`die(0xbad)` at the boot, the menu after a lost game).
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole intro.** This is a
  developer affordance with no CSBWin counterpart, kept deliberately: thirteen of the sixteen golden
  frames boot through it.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:969-975`, which has no counterpart here, so
  the branch is dead (`src/engine/PeriodicUpdates.ts:91`).
- 🚫 **A drawn `RandomGameID` is never 0, nor a stored save's.** CSBWin keeps the
  product of its two draws whatever it is (`doc/CSBwin-src/SaveGame.cpp:1638-1647`), and
  it is 0 when either low word is, about one new game in 32768. The author's decision:
  the port draws the next pair instead (`drawRandomGameID`, `src/engine/GameContext.ts`),
  which in that case leaves the stream two draws further on than CSBWin's. 0 is what a
  file of an earlier build holds, which names no playthrough, and the store stamps an
  id into such a file as it takes it (`doc/SAVES.md` → "A playthrough"): a game
  that drew 0 would write files the store takes for those. `tools/dump-new-game.ts`
  checks it on a stream whose first pair gives 0. The same goes for an id a save of the
  data set already holds, about one pair of games in 16 million: the page draws the next
  pair once the new game is read (`GameSaves.newGameRead`, `src/engine/GameSaves.ts`),
  checked by `tools/dump-save-menu.ts` on a store that holds a pinned stream's first ids.
- 🚫 **A `CSBgraphics.dat` sound plays its WAV file's `data` chunk.** `ReadSound` takes the
  sample count from byte 40 and the samples from byte 44
  (`doc/CSBwin-src/Sound.cpp:1024-1033`), which are the `data` chunk's only after a
  16-byte `fmt ` chunk. Sound 705 (`coat`) of
  both files here has a 4-byte `fact` chunk there, so CSBWin plays its four bytes, a
  click at most; the port plays the `data` chunk after it, its 4574 samples, the count
  the `fact` chunk itself gives. Every other sound starts its `data` chunk at byte 36, and
  plays as in CSBWin, as does a section that is not a RIFF file (`doc/PROVEN_FACTS.md` →
  "`CSBgraphics.dat`'s sounds are WAV files"; `SoundQueue.readSound`,
  `tools/dump-custom-sounds.ts`).
- 🚫 **Audio sample rates**, a documented exception to faithfulness:
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- 🚫 **`dm-atari/graphics.dat` is not CSBWin's file.** It is CSBWin's with two items from
  the Atari ST 1.2 disk: the credits scroll, which CSBWin's corrupts, and the pressed
  crack switch, whose front view shows its button pushed in and whose `Byte4100[55]`
  keeps it low on the wall, as in the original. `dm-windows/` keeps
  CSBWin's file as it ships. `doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's
  with three items from the 1.2 disk"; `tools/dump-dm-atari-graphics.ts` builds and checks it.
- 🚫 **The see-through door edge's last row.** `StdDrawSeeThruDoorEdge` reads graphic 41
  from pixel 128, so its last row runs 32 pixels past the graphic's end, into whatever
  CSBWin's memory holds there. `tag0088b2Explicit` (`src/renderer/csbwin/CanvasBlitter.ts`)
  writes nothing for them: `doc/PROVEN_FACTS.md` → "See-Thru-Walls is a counter read as
  a boolean".
- 🚫 **A wall-text glyph's rows past graphic 120.** `DrawWallDecoration` reads a code of
  36 or more on into the font's lower rows, and its last row from whatever follows the
  graphic in CSBWin's memory. The port draws the rows the graphic has and writes nothing
  for the rest (`drawWallText`, `src/renderer/bytecode/DrawDecorations.ts`). No wall text
  in the data here has such a code: `doc/PROVEN_FACTS.md` → "A wall text's glyph is read
  from graphic 120 with no check of its code".
- 🚫 **A record read through a slot `DeleteDBEntry` has freed.** Such an RN names no record,
  and CSBWin reads one anyway in two places. `MakeMoreRoomInDB` hands back the freed slot
  of the group or missile it threw out, and `FindEmptyDB<n>Entry` reads past the databases
  through it: `makeMoreRoomInDB` (`src/engine/MakeMoreRoomInDB.ts`) names the freed record
  anew, `RN(dbType, index)`, as the Atari original's RN still named it
  (`doc/PROVEN_FACTS.md` → "A full database throws one object out of the dungeon"). A
  missile whose own wall filter moved the party into it is deleted by that hit, and its
  encounter's tail calls `ProcessObjectFromMissile` on it again; the port's
  `processObjectFromMissile` finds no record and does nothing
  (`tools/dump-move-from-missile.ts`, section 3).
- 🚫 **An index CSBWin does not bound reads nobody.** `&CHAR@`, `&TALENTS@` and
  `&TALENTS!` take an index of 0x20000 or more with bit 16 clear as `d.CH16482 + charIdx`
  (`doc/CSBwin-src/DSA.cpp:4197`, `:4275`, `:4326`), a record over 100 MB past `d`;
  `&CHAR@` of a champion in the wings takes `d.PendingDamage[charIdx]` off their HP, bit
  16 and all, 128 KB past that array of four (`:4201`), and the port takes nothing; and
  `&EXPERIENCE+` reads the HP of a negative one from the `d.` variables before the array,
  then hands it to `AddToSkill` (`:4553`). The port reads zeros, leaves the talents and
  adds nothing (`executeAmpersand`, `src/engine/DsaSystem.ts`). A slot from 0 to 3 that no
  champion fills is a different case, and is read as CSBWin reads it
  (`PartyState.vacantCharacters`). Two more reads past an array go the same way:
  `DSADBANK::GetText` takes a text index past 9 once a text is set
  (`doc/CSBwin-src/DSA.cpp:208-213`), and `PrintWithSubstitution`'s `@p` with no attack
  menu open names `d.CH16482[-1]` (`Graphics.cpp:1591`); the port reads "" for both
  (`DsaBank.getText`, `src/engine/PrintWithSubstitution.ts`). `&LOC2ABSCOORD` of a level
  that is not there and `&MULTIPLIER@` of a negative one read a level descriptor past
  the array (`DSA.cpp:324-325`, `:3985`): the port reads zeros. And `&VSET` with a count
  whose sum with `dst` or `src` wraps past 2^32 writes past the 100 variables
  (`:4863`, `:4882`): the port stops at the last (`DsaSystem.vset`). `RemoveCharacter`,
  with no other champion living, hands the cursor and the magic tab to slot
  `d.NumCharacter` (`Character.cpp:5343-5360`), which `SetHandOwner` and
  `SelectMagicCaster` take when its HP is not zero: the record a slot past the party
  keeps, or, the party being four, `d.PartyFootprints[19]` past the array. The port's
  refuse any slot past the party (`removeCharacter`, `src/engine/SwapCharacter.ts`).
- 🚫 **The Hint Oracle's ink after a button's flash is item 0's word 5.** `_TAG008c40_8`
  resets the ink from `Long16864`, which CSBWin's own comment puts at byte 8 of
  `f.Segment1_16872`, words 4-5 (`doc/CSBwin-src/Hint.cpp:375`), but reads as
  `f.Segment1_16872+8`, an `i16` array plus 8, words 8-9 (`:7786`): a byte offset taken
  as a word index. The port keeps the low word of words 4-5, word 5 (9), where CSBWin
  keeps word 9's (3) (`HintOracleScreen.tag008c40_8`,
  `doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "Item 0"). No pixel differs: every text is
  drawn after an ink set of its own (`:4920-4941`, `:7776-7782`).
- 🚫 **The inventory's close box is the Hint Oracle's button**, in a data set with the
  Oracle's files (`csb`). CSBWin reaches the Oracle only from its launcher's HINT choice,
  which reads a saved game's square. The port has no launcher, and a button of its own
  has no room left of the disk: a name and a title at their longest reach it. So the
  close box, `buttons17760`'s entry 3, left button, opens the Oracle on the party's
  square, searched as the port's button 149, and shows the Oracle's `?`
  (`src/renderer/ui/HintOracleButton.ts`). The inventory still closes the way it opens,
  with a right click (entry 0, button 11) or the champion's name. Without the files the
  close box is CSBWin's (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "In the port: the
  inventory's button"; `tools/dump-hint-oracle-button.ts`).
- 🚫 **DONE on the Hint Oracle's title list closes it.** CSBWin's goes back to the load
  screen (`w_4 = 1`, `doc/CSBwin-src/Hint.cpp:7375-7388`), whose floppy prompts and save
  chooser only lead to a square, and the port's Oracle has the party's
  (`HintOracleScreen.run`, `src/renderer/intro/HintOracle.ts`).
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
