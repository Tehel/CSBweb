# dmweb – Technical debt

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
unported features it needs come next, and whatever it does not need waits. Three pieces
of work follow it, the author's next challenges: a redesigned page, the save menu rework
(`P10`), and a second dungeon (Chaos Strikes Back first). Tiers D and E hold what the
code needs before them: a base solid enough to build them on. `E15` is the page
redesign's first step.

The order, then:

1. **D and E.** New structural debt still goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** A divergence found along the way goes here and is
   taken before the G items: a known bug outranks a missing feature.
3. **The save menu rework** (`PLAN.md` → Phase 10, the index's `P10` row), saves that
   know their dungeon with it. The author's order puts it before the G rows.
4. **G — Unported CSBWin features the default dungeon reaches**, in the index's order.
5. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**Postponed (⏸️) until the default dungeon is validated.** These are not taken in order,
and no session picks one up unless the author names it:

- **DSA extensibility.** The retail dungeon defines no DSA (`PLAN.md` → Phase 10), so
  nothing it does could be verified: the missing opcodes, the DSA filters, and what only a
  DSA reaches (the wings, `talents`).
- **CSBWin's extensions for custom dungeons**: malformed heroes, external portraits, the
  monster design options.
- **CSBWin's debugging features** that are not part of the game (the ASCII dump).
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
| P10 | The save menu rework, with saves that know their dungeon | L | in `PLAN.md` → Phase 10 |
| G17 | A new Chaos Strikes Back game: the prison and "MAKE NEW ADVENTURE" | M | ⏳ |
| E15 | The page shell | L | ⏳ with the page redesign |
| F12 | The tools' scaffolding is copied, and reaches privates through unchecked casts | M | ⏳ |
| F13 | `npm test` runs its tools one at a time | S | ⏳ |
| F3 | Phase 15 step 4 | — | in `PLAN.md` |
| G1 | DSA gaps | — | ⏸️ |
| G2 | Eleven DSA filters | — | ⏸️ |
| G3 | The wings | — | ⏸️ |
| G4 | Custom-dungeon extensions: `talents`, malformed heroes, external portraits, the monster design options | — | ⏸️ |
| G14 | `AsciiDump`: the resumed game's "ASCII DUMP" | — | ⏸️ |
| G20 | The hint oracle | — | ⏸️ |
| G21 | `Translation.txt`: the messages the executable prints, translated | — | ⏸️ |
| X1 | Extra: drinking from a fountain with an empty hand | S | ⏸️ |
| X2 | Extra: a mastery just gained shown in green | S | ⏸️ |
| X3 | Extra: thrown weapons gathered back when the party walks over them | M | ⏸️ |
| X5 | Extra: 3D2D1D's vertical moves and gravity | L | ⏸️ |
| X6 | Extra: the Hint Oracle's hints in the game, as the party moves | M | ⏸️ |
| X7 | Extra: the FTL logo before the title | M | ⏸️ |
| H | Deliberate divergences | — | 🚫 |

The rows above G1 are the active list. `P10` and `F3` are phases, whose status is
`PLAN.md`'s; a session that takes `P10` works there, one step at a time. One row sits
out of its tier's place on purpose: `E15` below `G17`, because it waits for the page
redesign to start: a session that reaches it first asks the author, and takes the next
row meanwhile. The F
rows are independent of the rest ("Priority", point 5), so they can be taken anywhere.
The ⏸️ rows are postponed (see "Priority") and are never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C112 · D16 · E21 · F14 · G22 · X8. An ID recorded and paid in one commit has no
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
- **`static/` is Vite's `publicDir`** (`vite.config.mts`), so a build copies all of it:
  `CSBwin.exe` and the three zips, Conflux, the author's saves, the manuals and the
  backstory, and assets the page does not load (`static/glfx.js`,
  `static/glfx-latest-minified.js` — the page loads `src/lib/`'s copy —,
  `QPN59-1400x1000.png`, `QPN59-320x200-cropped.png`).
- **`server.js`** is an Express static server from before Vite, on port 9010, with an
  unauthenticated `/stopserver` that exits the process; `package.json` keeps its two
  runtime dependencies, `"main": "server.js"` and the name `dmjs`.

Paying it is the redesign's first step: settings as a model the page renders, the CRT in a
module of its own, a `publicDir` holding only what the page serves, and `server.js` gone.

---

## C — Known divergences from CSBWin

A divergence found along the way goes here, with the next free ID.

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

- 35 tools define a champion-building function of their own, and 38 spell out
  `addCharacterDefaults()`; 106 construct a `DungeonLoader` and 85 read
  `dm-atari/dungeon.dat` themselves.
- 5 tools stand in for an engine call the UI makes by assigning over the system's method
  (`executeAttack`, `castSpellFromUi`, `consumeAttackDamageToDisplay`), which nothing
  types as a stand-in or puts back; 28 extract the UI tables again
  (`graphicsTablesOf(…).ui`) beside the `UIState` that `tools/lib/ui.ts` builds them
  into.
- 33 tools make 72 `as unknown as` casts: into `Game`'s private members (`lastInputTime`,
  5; `gameTick`, 6), into other systems' (`DsaSystem`'s
  `teleportParty` and `findCharacterSource`, `wiggleEverything`, `stepOrDefer`,
  `climbDownIntoPit`, …), and to pass partial `UIState` literals (17); three more reach
  `DsaSystem`'s privates through `as any` (`moveObjectDsa`, `executeAmpersand`). `tsc`
  checks none of them. A renamed member leaves the tool compiling, and a write to it then
  sets a new property: a tool that pins `lastInputTime` would go on passing while testing
  nothing.

Paying it: `tools/lib` helpers for the stock dungeon and a test champion, beside
`newUIState` (`tools/lib/ui.ts`), which the 17 partial `UIState` literals move to; a narrow public seam for what the tools
legitimately drive, the input gate's clock (`lastInputTime`) and a tick (a VBL is
`runFrame`, and `runVbl` sets its count); then the casts go,
one tool per commit, each tool's output byte-identical.

### F13 ⏳ `npm test` runs its tools one at a time

`tools/run-checks.mjs` spawns its 132 checks sequentially (`spawnSync`, `:253`), each a
`tsx` start of 300 ms or more, so the gate takes over a minute (the ~80 s `CLAUDE.md`
and the runner's header give). Most sessions run it several times. Paying it means a pool
of workers the size of the machine, the output still printed in the list's order, and
those timings updated.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. The active ones come in the index's order; the
postponed ones follow, under their own heading (see "Priority").

### G17 — A new Chaos Strikes Back game: the prison and "MAKE NEW ADVENTURE"

CSBWin makes a CSB game in three steps (the utility's own header,
`doc/CSBwin-src/Chaos.cpp:1-5`):

1. **DUNGEON → Enter** reads `dungeon.dat`, the prison, and the party is saved from
   it as `CSBGAMEn.DAT` (`SaveGame.cpp:902-908`). Where the champions are chosen in it is
   not yet traced. The port reads the compressed prison (`DungeonLoader.loadDungeonDat`,
   `doc/PROVEN_FACTS.md` → "A compressed `dungeon.dat`: CSB's prison").
2. **UTILITY → "MAKE NEW ADVENTURE"** (`_StartChaos`, `Chaos.cpp:2686`; the editor screen
   `_DrawCharacterEditorScreen`, `:3755-3789`, and its dispatcher `_TAG004518`,
   `:3874-4022`, where only button 13 does real work). It loads the source save
   (`_ReadSavedGame(0)`, `:2207-2496`, a CSB or a DM save: `DMGAME.DAT` is offered,
   `:376-377`), refuses one already used (`_TAG00260e`, `:2501-2546`: "ALREADY UTILIZED"
   unless `Byte22596` or `Word22594` is 1 and `Word22592 <= 13`) or with duplicate names
   (`CheckChampionNames`, `:1434-1462`), loads `mini.dat` (the eleven-level CSB dungeon,
   `:2246`), which must have `Word22592` 13 (`_TAG0026c4`, `:2551-2566`), and copies the
   party in (`TAG002724`, `:2571-2680`): the four `CHARDESC`s with their facing rotated,
   HP, stamina and mana full, food and water `1500 + (rand & 255)`, every attribute at its
   maximum with minimum 30 (Luck 10), skills' `tempAdjust` 0 but experience kept, every
   possession slot empty, `RandomGameID + 1`, and `Word22594`. It writes the result as a
   new save (`_TAG000fc4`, `:1643-1898`).
3. **DUNGEON → Resume** loads that save. An Atari-era save, with no Extended Features
   block, is a CSBWin file, and installs its own world whatever the running game's
   (`tools/dump-atari-saves.ts`).

A DM party can therefore be carried into CSB, which is the classic way to play it.
**How the port offers step 2 (the author's decision): its engine only.** Port the
checks and `TAG002724`'s copy, and run them from the page or the save menu on a chosen
source save, writing a new save. The utility's screen is not ported, and step 2 is not
run automatically when the prison's party is saved.

### Postponed until the default dungeon is validated

Not taken in order; the author names one to start it (see "Priority").

### G1 ⏸️ DSA gaps

- **Opcodes.** Unimplemented DSA opcodes and `&` subcodes are traced once each through
  `warnedOps` (`src/engine/DsaSystem.ts:1257`, `:1864`). Those warnings are the list.
  Slave DSAs are not implemented (`findMaster`, `:1896-1905`).
- **`STKOP_Throw`** (`DSA.cpp:4558`) is one of the missing opcodes, so
  `TimerSystem.throwMissile` (`ThrowMissile`, `Timer.cpp:2016`) has no caller. When the
  opcode is ported, re-port the function's missile-type switch first. CSBWin throws a spell
  only for the eight words it lists (`RNFireball` … `RNPoisonCloud`, `RNMonsterDeath`), and
  nothing for any other non-zero word (`Timer.cpp:2029-2040`). The port takes every word
  `>= 0xff80` as-is and maps the rest through `spellObjectId`. CSBWin also `LoadLevel`s the
  launch level around the launch (`:2065-2077`).
- **`STKOP_SetCurse`** (`DSA.cpp:3440-3456`) is another. It calls `SetCursed`
  (`Character.cpp:1782-1816`), which finds the champion carrying the object and brackets
  the curse change with `AdjustStatsForItemCarried(…, -1, …)` and `(…, +1, …)`, so a curse
  laid on a carried weapon costs 3 Luck at once. Port both together.
- **Saving a dungeon with DSAs.** `DSA::Write` (`doc/CSBwin-src/Chaos.cpp`) is unported, so
  `buildSaveFile` refuses a dungeon that defines one rather than write a file without
  them (`src/engine/SaveGameFile.ts`), and `saveSaveGameState` writes a loaded save's
  DSA section back verbatim (`SaveGameState.dsaBlock`), where a DSA whose state has moved
  since the load would be written as it stood.
- **`ECF_FOOTPRINTS`.** The footprint arm of `SummarizeRoomInfo` also shows prints on any
  cell with this extended cell flag once `d.Time > 0` (`Codea59a.cpp:419-425`). Only a
  DSA or a custom dungeon sets extended cell flags. The magic footprints are drawn
  (`src/renderer/csbwin/SummarizeRoomInfo.ts`, beside a comment naming this item).

### G2 ⏸️ Eleven DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_DAMAGECHARFILTER` (actuator type 47, `Character.cpp:2829-2893`), which may rewrite
  the damage `DamageCharacter` is about to add to `d.PendingDamage`
  (`MonsterAttack.damageCharacter`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:112`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:337`).
- `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`). It counts each kill in `expool`'s
  statistics and, when the dungeon has an `ESL_DELETEMONSTERFILTER`, runs its type-47 DSA,
  which may set `deathCloud` and `dropResidue`. CSBWin calls it from `DamageMonster` with
  `DMW_Damage` (`Code11f52.cpp:1112`, `:1122`) and from `MoveObject`'s two deletions with
  `DMW_Movement1` / `DMW_Movement2` (`:3151`, `:3304`). The port's matching places are
  `MonsterDamage.ts:463` and `MonsterSystem.ts:548`.
- `MonsterAttackFilter`, which may rewrite a monster attack's whole parameter block
  (`MonsterAttack.ts:146`). CSBWin's block is a file-scope global
  (`doc/CSBwin-src/Monster.cpp:917-938`), and `MonsterAttacks` never writes its
  `disableTime`, which no C++ reads, so a filter sees the value the last filter left there.
  The port builds a fresh block each attack, with `disableTime` 0.
- `CallPartyMoveFilter` (`CSBCode.cpp:8119`), which may rewrite the stamina adjustments or
  refuse the move, with its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8122-8128`,
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:255`).
- `ActionNameFilter` (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8680`), which may rename an
  attack option. The names come straight from `AttackNames`.
- `CursorFilter` (`ESL_CURSORFILTER`, `MoveObject.cpp:797`), which may cancel what is
  about to happen to the object on the cursor. CSBWin sends it a packet from 21 places.
  The port sends six of the packet types, all from `ActuatorSystem` (the key, the torch
  holder, the swap, the gift), to `GameHost.cursorFilter`, which `main.ts` answers with a
  debug trace. None of the other types is sent, among them `HandleClothingClick`'s
  `PlaceOnCharacter`, which may cancel the click, and `PickFromCharacter`
  (`CSBCode.cpp:6966-6972`, `:6982-6991`).
- `ESL_EQUIPFILTER`, which `CHARDESC::SetPossession(…, true)` runs before it writes the
  slot, once with timer function 1 for the object leaving and once with 0 for the object
  arriving (`Character.cpp:2917-2998`). Both halves of the pair write through it
  (`:1850`, `:1962`). The port's pair writes with `CharacterSystem.setPossessionDirect`.
- `SoundFilter` (`ESL_SOUNDFILTER`, `doc/CSBwin-src/Sound.cpp:670`), which `QueueSound`
  calls once it has the volume, and which may play the sound through a DSA instead
  (`CSBCode.cpp:1877`). `SoundQueue.queueSound` plays straight on.

### G3 ⏸️ The wings

CSBWin keeps champions who have left the party in a store that `CHARDESC::GetFromWings` /
`SaveToWings` reach (`doc/CSBwin-src/Character.cpp:5239`). Two things consult it, and
cannot here:

- `CopyCharacter`, so bones dropped by a departed champion take no name;
- `ProcessTT_ViAltar` state 1, which heals such a champion to `MaxHP/2` and saves them
  back (`Timer.cpp:2769-2782`).

`Party.findChampionByFingerprint` is where both would grow their second half. Only a DSA
fills the wings: `STKOP_SwapCharacter` (`DSA.cpp:4413-4419`) is the one caller of
`SwapCharacter` (`Character.cpp:5472`), and through it of `CharacterDelete` / `CharacterAdd`
and every `SaveToWings`. Nothing in the retail game removes a living champion from the
party.

### G4 ⏸️ Custom-dungeon extensions: `talents`, malformed heroes, external portraits, the monster design options

- `pcA3->talents`, which `Champion` has no field for. `AddCharacter` decodes it from the
  hero text (`Character.cpp:688`), and only a DSA reads it (`DSA.cpp:4220`, `:4287`,
  `:4337`);
- the `legalHero` fallback (`Character.cpp:475`), which clamps an out-of-range hero text
  and retries it against "BOGUS / ILLEGAL HERO", where `HeroExtractor` rejects it
  outright;
- external portraits for `charID > 23`.

No shipped DM hero touches any of these.

**Two file matters.** `SimpleEncryption` (`EF_FLAGS` 0x04) puts the whole file, a save or
a `dungeon.dat`, behind `RC4.cpp`'s cipher (`doc/PROVEN_FACTS.md` → "The "simple"
encipherment is `RC4.cpp`'s own cipher"), and CSBWin sets it only when it reads a file
already enciphered (`doc/CSBwin-src/SaveGame.cpp:326-338`); `readExtendedFeatures`
deciphers the 512-byte header and no more, so an
enciphered file fails at the object maps, and the writer never sets it. Conflux 3.5's
`dungeon.dat` is such a file, and the canary for reading one
(`tools/dump-extended-features-read.ts`). And `MakeBigActuators` reads each actuator's type before
the byte swap, so CSBWin takes bits 8-14 of `word2` for it where the port takes the type
(`doc/PROVEN_FACTS.md` → "`MakeBigActuators` runs before the byte swap");
`tools/dump-dungeon-conversions.ts` fails if a dungeon has a type-47 actuator under either
reading, and DM has none.

**The monster design options.** `DB4::invisible()` is gated on `invisibleMonsters`, and
`drawAsSize4()`, `Unique()` and `Poisoned()` on `drawAsSize4Monsters`
(`CSB.h:1125-1132`). Both options are read from a save's `extendedFlags`
(`SaveGame.cpp:394-400`, `false` by default). The port models neither: `CreatureRecord`
holds the raw bits, the renderer's `DrawRoomObjects` / `DrawMonster` take both options as
false (every creature drawn, never `DrawSize4Index`), and `monster.drawAsSize4` is read ungated in
`MissileEncounter.processMissileEncounter` (`MissileEncounter.ts:373`) and in `MonsterDamage`
(`:504`, `:540`). Only `monsterUnique` (`MonsterSystem.ts:70`) applies a gate, as a
constant `false`. Harmless for now, because no creature in `dm-atari/dungeon.dat` sets any
of bits 11-14. Modelling it means reading `EF_EXTENDED_FLAGS.InvisibleMonsters` and
`DrawAsSize4Monsters` in `readExtendedFeatures` and gating every accessor.

### G14 ⏸️ `AsciiDump`: the resumed game's "ASCII DUMP"

`AsciiDump` (`doc/CSBwin-src/AsciiDump.cpp:2137`) writes the whole dungeon as text to
`ASCIIDUMP.TXT`, starting with the game's and the levels' information, every cell, the
objects, and the monsters (`:2152-2160`). The one route to it is the second button of the
"GAME LOADED, READY TO PLAY." menu (`CSBCode.cpp:10497-10515`), which in the port only puts
the menu up again (`tag021028`, `src/renderer/intro/BootSequence.ts`). In a page it would be
a download.

### G20 ⏸️ The hint oracle

CSBWin's HINT choice (`_StartHint`, `doc/CSBwin-src/Hint.cpp:6454`, a 7936-line file)
reads a CSB save and answers questions about where its party stands. It is not the
game, so it waits; the author names it to start it.

Its data is read: `parseHintOracle` (`src/data/HintOracleLoader.ts`) decodes
`hcsb.hct`, and `hintsAtPosition` is `_TAG00799a_9`'s lookup
(`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`, checked by `tools/dump-hint-oracle.ts`). What is
left is the Oracle's own screen: `hcsb.dat`'s three items, the title menu, the pages,
and the save chosen from CSBWin's menu. An `hcsb.hct` enciphered under a save's
`hintKey` (`RC4.cpp`'s cipher, `:5401-5405`) is not read; no save here has a key.

### G21 ⏸️ `Translation.txt`: the messages the executable prints, translated

The messages the executable prints are string literals in CSBWin: " MUMBLES A MEANINGLESS
SPELL.", " RESURRECTED", "READY TO SAVE GAME" and so on. `ReadTranslationFile` reads
pairs of quoted strings, English then translation, from the game directory's
`Translation.txt` (`doc/CSBwin-src/Translation.cpp:14-58`, called at `CSBUI.cpp:906`), and
`TranslateLanguage` swaps a literal for its pair at 24 call sites (`Magic.cpp:1016-1033`,
`CSBCode.cpp:6806`, `Character.cpp:3249`, `SaveGame.cpp:871-875`, `Graphics.cpp:309`, `:1546`, …).
Not every message goes through it: " JUST GAINED A " (`Magic.cpp:175`) does not. The port
prints the English literals. A translated `graphics.dat` and `dungeon.dat` (the French 1.3
set) therefore play with English messages. Paying it means porting the two functions and
reading the file from the data set's folder; the French set would still need a
`Translation.txt`, which no file here provides.

---

## X — Extras (not in CSBWin)

Features from later versions of the game or from elsewhere, which the author wants once
the default dungeon is validated. Postponed (⏸️) like the G items below "Postponed", and
taken only when the author names one.

Rules for all of them:

- **One setting, off by default**, a `UISettings` flag (`src/ui/settings.ts`) that the
  first extra paid adds and the others share. With it off, the game is CSBWin's: every
  tool's output and every golden frame stay the same. The coloured object cursor is the
  exception: the author wants it on by default, so it is recorded under H.
- **None of them is saved.** What an extra keeps in memory is lost on a save and a load,
  in the port's runtime save as in a CSBWin file, and that is acceptable: no save format
  changes.
- **Each ships with its `tools/` check**, run with the setting on, and its entry here is
  deleted as for any paid item.

### X1 ⏸️ Drinking from a fountain with an empty hand

CSBWin's fountain is a wall decoration, not an actuator: the renderer sets
`d.FacingWaterFountain` when the decoration in front is `d.Word4040[0]`
(`doc/CSBwin-src/CSBCode.cpp:3302-3308`), and a click on viewport button 5 with it set
fills a waterskin or an empty flask held in the cursor, and does nothing else
(`doc/CSBwin-src/Mouse.cpp:1194-1225`). The port has the same thing in
`tryUseFrontWallItem` (`src/renderer/ui/ViewportPicking.ts:134`), which returns at once
when the hand is empty.

The extra: with an empty hand, the **cursor owner** drinks. That is the same drink as one
gulp from a full waterskin: `waterValue = 800` and `SOUND_GULP` (`computeFeedParameters`,
`src/renderer/ui/Feeding.ts:57-66`), applied through `applyFeedParameters`, so the water cap
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

- **THROW** (`atk_THROW`, `src/engine/AttackSystem.ts:1458`) throws the weapon-hand object,
  slot 1, through `MouseSystem.throwFromWeaponHand` (`src/engine/MouseSystem.ts:44`).
- **SHOOT** (`attackWithShoot`, `src/engine/AttackSystem.ts:1550`) fires the ammunition
  held in slot 0 through `MagicSystem.launchObject` (`src/engine/MagicSystem.ts:544`).
  `launchObject` also launches spells, so the object is tagged in the attack, not there.

A thrown object keeps its `ObjectID` all the way: in the missile's `projectileObject`,
on the floor where it lands, and in a monster's possessions when a hit absorbs it
(`MissileEncounter.ts:436`), which the monster drops when it dies. So a tag table
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

### X5 ⏸️ 3D2D1D's vertical moves and gravity

`doc/3D2D1D.md` has the whole account. The 3D2D1D dungeon (data set `3d2d1d`) loads but
cannot be played as designed. It needs two features that `doc/CSBwin-src/` contains but
hardwires off: `ThreeDMovements` and `GravityGame` are `false` and never assigned
(`doc/CSBwin-src/data.cpp:239-240`).

The 2019 `CSBwin.exe` shipped with the dungeon sets them from `efb.extendedFlags` bits
`0x400` and `0x200`, bits our `EXTENDEDFLAGS` enum does not have. That is known only from
the exe's disassembly, so porting it means citing the exe for those two bits. It becomes
a new exception to "CSBWin source wins", to be recorded under H when this is paid.
Everything else is in our source.

The gate is the dungeon, not a setting. This is the one departure from the X rules above:
no other dungeon here sets either bit, so DM and CSB are unchanged, and the keys cannot
be used to cheat there.

Two steps:

1. **Vertical moves** (M). Read the two bits into the rules, next to
   `readRulesOptions` (`src/data/CsbwinExtendedFeatures.ts`). Bind the PC keys `-` and
   `=` (`KeyboardEvent.code` `Minus` and `Equal`, scancodes `0x0c`/`0x0d` in
   `config.txt`) to keyscans `0x4900`/`0x4a00`. Queue them as buttons
   `0x1124`/`0x1125` when `ThreeDMovements` is set (`TAG0196da`,
   `doc/CSBwin-src/CSBCode.cpp:8476-8490`). Hand those two buttons to the move in
   `Game.handleMouseEvents` (`Mouse.cpp:1556-1570`). Then port `MoveParty`'s
   `direction > 3` arm (`CSBCode.cpp:8168-8290`) into `MovementSystem`: the pit rule,
   `TraverseStairway(direction-4, false)`, and the wall bump.
2. **Gravity** (M). `moveHistory`, `gravityMove` and `nextGravityMoveTime`, updated in
   `MoveParty` (`CSBCode.cpp:8041-8083`). `GravityMove` (`Mouse.cpp:1258-1342`) and its
   hook at the head of `_HandleMouseEvents` (`:1381-1390`), which empties the queue while
   gravity runs. CSBWin does not save the three variables, so neither does the port.

A `watch-*.ts` proves each step on the real 3D2D1D files: up and down through map 1's
fake pits, a refused move into stone with its damage, and a gravity slide ending where
`GravityMove` finds no axis. 3D2D1D's six DSAs use only MESSAGE, OVERRIDE,
COPYTELEPORTER and GOSUB, and it has no party-move filter. A hand probe ran the 1D
corridor's chain correctly in the engine (`doc/3D2D1D.md`), but no tool proves it yet.
Playing the dungeon through also needs saving, which waits on G1's `DSA::Write`:
`buildSaveFile` refuses any dungeon that defines a DSA.
`static/gamefiles/3D2D1D/WALKTHROUGH.md` is a full route computed from CSBWin's rules
by `tools/solve-3d2d1d.ts`, outside the engine. Once both steps are in, a tool that
replays it through `Game` is the end-to-end proof.

### X6 ⏸️ The Hint Oracle's hints in the game, as the party moves

CSB's Hint Oracle answers from a saved game, outside it: it lists the titles of the
hints for the party's square and level, and shows a chosen one page by page, from a
nudge to the answer. Its data is decoded already (`parseHintOracle` and
`hintsAtPosition`, `src/data/HintOracleLoader.ts`; the format and the lookup in
`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`): 210 hints, 492 pages, 3891 squares on levels
0-9.

The extra offers the same hints live, from the party's position in the running game.

- **Loading.** `main.ts` fetches `${dataSet.dir}/hcsb.hct` next to `dungeon.dat`. Only the
  `csb` set has one; without it the extra is absent, whatever the setting. The
  coordinates are the CSB dungeon's (`partyLevel`, x, y), so the file means nothing
  against another dungeon.
- **The lookup.** On every square the party arrives on (a step, the stairs, a pit, a
  teleporter), `hintsAtPosition(oracle, partyLevel, x, y)`, as the Oracle does from a
  save. The level-wide records (x and y 0xff: a "CREATURES" hint on every level, and
  one about the level as a whole on most) match every square of their level, so they
  are shown apart from the square's own, or the indicator would never go out.
- **Showing it.** A sign that the square has hints; a click lists their titles; a title
  shows its first page, and each further page is asked for, as the Oracle does, so a
  player takes only as much help as they want. Where it is drawn, on the canvas or
  beside it, is the author's to decide before this is taken.

A `tools/` check with the setting on: walk a CSB party onto a square with hints (level 0
(3,23) offers CREATURES, THE MAZE and FULYA PIT, in that order), across a teleporter
and down a pit, and check what the extra offers after each move.

---

### X7 ⏸️ The FTL logo before the title

The Atari ST disk booted into `SWOOSH.IMG`, which drew the FTL logo with a palette reveal
and a noise "swoosh" before the game's own title animation. CSBWin never had it: it lives
in the boot chain, not in the game program. Everything about it is in
`doc/ATARI_ST_DISK_REFERENCE.md` → "`SWOOSH.IMG`", and `static/gamefiles/swoosh/`, which
every version shares, holds the file and a recording of its sound.

To do:

- Read `swoosh.img` and decode its picture: a transcription of `swoosh.img:$0070`–`$01d4`
  (the RLE codes, the run masks, the copy from the line above), with a `tools/` check that
  it consumes exactly 2306 bytes and ends on the 64000th pixel.
- Run its palette script from `$0b92` on the intro host (`src/renderer/intro/IntroHost.ts`),
  30 VBLs, before `TitleSequence`, starting the sound at VBL 0.
- The sound: `swoosh.wav`, a recording of the real one, through `SoundManager`.
- **The hold after VBL 30 is the author's arbitrary choice**, since neither the disk nor
  the recording gives one. The code marks it as such. Initial value will be to stay still 1s
  after the end of the animation, then quickly fade to black and start the title animation.
- Behind the extras' setting, off by default, so the boot and the golden frames are
  unchanged with it off.

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

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
  (`doc/CSBwin-src/CSBCode.cpp:3542`), compensates for `MakeMirror` reversing a
  byte-aligned buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would
  shift a correctly aligned image. The reasoning is in the code.
- 🚫 **`CHARDESC.load` is recomputed** from the possessions, rather than cached and adjusted
  at each of CSBWin's eight possession writers. Same value, and it cannot drift. `Party.ts`
  made the same choice for `SetHandOwner`. Recorded in the module comment of
  `src/engine/CharacterStats.ts`.
- 🚫 **`_FlashAttackDamage` does not stop the game.** CSBWin's ends in `VBLDelay(15)`,
  which halts everything for a quarter of a second. The port shows the flash as a timed
  overlay of the same length while the game keeps running, as it already does for the
  feeding animation (`src/renderer/ui/Attack.ts`, module comment).
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
- 🚫 **A script's caller finishes at once.** `Game.runScript` returns as soon as the script
  reaches its first `VBLDelay`, so what CSBWin's suspended caller would do after the script
  ends, the port's does before it. The fusion and the CSB win's wait end the game, and the
  callers' tails that anything could still see are skipped (`executeAttack` and
  `handleAttackAreaClick`, `src/renderer/ui/Attack.ts`). `_MagicSelection`'s callers
  (`handleMagicClick`, `handleUIKey`) do nothing after it, and the rest of the pass it
  holds runs in the VBL the script ends (`Game.runFrame`). What is left is `HandleMouseEvents`' `lastTime = d.Time`
  (`doc/CSBwin-src/Mouse.cpp:1647-1649`), stamped at the click, which nothing reads after
  the credits.
- 🚫 **A champion who dies in hand is put down on nobody.** `KillCharacter` does not end a
  change of the marching order, and `TAG0025a6` then writes the dead champion's facing and
  position to `d.CH16482[-1]`, outside the champions (`doc/PROVEN_FACTS.md` → "Changing
  the marching order"). The port writes them to no one and does the rest: whoever stood on
  the target square still moves (`tag0025a6`, `src/renderer/ui/Mouse.ts`).
- 🚫 **A fifth rune is refused.** `TAG01b990` writes the rune at `byte33`, then sets
  `byte33 = (byte33 + 1) & 3` (`doc/CSBwin-src/CSBCode.cpp:8985-8988`), so after four
  runes CSBWin's keypad shows the first row again and the next rune starts a new
  incantation over the old one. The author's decision: the port refuses any rune past the
  fourth, and the keypad keeps showing the fourth row (`tag01b990` and
  `drawSpellPanel`, `src/renderer/ui/MagicPanel.ts`). A save still carries `byte33` as
  CSBWin's writers leave it, `strlen(incantation) & 3` (`CsbwinCharacters.ts`).
- 🚫 **No caster tab without mana.** `DrawSpellControls` draws a tab for every champion
  whose `HP()` is not zero (`doc/CSBwin-src/Character.cpp:4994-5087`), and
  `_HandleMagicClick` picks among them (`Magic.cpp:596-699`). The author's decision: the
  port draws no tab for a champion whose maximum mana is zero, and neither a click nor a
  key selects one (`drawSpellControls` and `handleMagicClick`,
  `src/renderer/ui/MagicPanel.ts`; `selectCaster`, `src/renderer/ui/Keyboard.ts`). The tab
  appears once the champion's maximum mana rises above zero.
- 🚫 **Word sizes from the file.** Two of CSBWin's constants are the English words'
  sizes: `AttackNames[300]` in graphic `0x230` and the source widths `DisplayFoodWater`
  blits the food, water and poisoned labels with. The French 1.3 `graphics.dat` has
  longer words in both places, so `parseGraphic230` sizes the names from the graphic's
  length and `drawFoodWaterPanel` reads each label at its own width. Every other set gets
  CSBWin's numbers (`doc/PROVEN_FACTS.md` → "The French 1.3 `graphics.dat`: longer
  words").
- 🚫 **The vertical-move guard** in `MoveParty` (`CSBCode.cpp:8200-8204`) is not ported,
  because CSBWin cannot reach it either. Move Up / Down (`0x1124` / `0x1125`) come only from
  the 3DMaze extension's `ThreeDMovements` keys and `GravityMove`, whose flags are
  initialised `false` (`data.cpp:239-240`) and assigned nowhere in the tree.
- 🚫 **The main loop makes one pass a VBL, not one a message.** CSBWin's loop makes a pass
  for every message the UI hands it (`doc/CSBwin-src/CSBUI.cpp:1253-1272`): each VBL's
  `UIM_VBL` (`system.cpp:624-630`), and a mouse button going down, which pushes a message
  of its own (`CSBUI.cpp:1185-1201`, `:1207-1222`). Every pass runs `HandleMouseEvents`,
  the tick if `d.clockTick` is set, and takes one print-queue entry (`CSBCode.cpp:714-765`).
  The port's `Game.runFrame` is one pass a VBL, and `onMouseClick` only queues: a click
  waits for the next VBL, at worst about 17 ms, and takes no print-queue entry of its own.
  The author's decision: the delay is too small to matter.
- 🚫 **`WaitForButtonFlash` does not hold the main loop's pass.** CSBWin's waits a VBL for
  the flashed rectangle to be put back (`doc/CSBwin-src/CSBCode.cpp:8561-8601`), and so
  does `_FlashButton` for it to be inverted (`:7713-7730`), while the port's pass never
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
- 🚫 **A damaged file at the boot goes back to the title.** There `tag01efee` prints
  "SAVED GAME DAMAGED!" and calls `die(0xbad)`, which ends CSBWin
  (`doc/CSBwin-src/SaveGame.cpp:1905-1907`). A page cannot end itself, so the author's
  decision is a one-button menu with the line and OK, whose click goes back to the title
  animation (`tag01efee` and `runBootSequence`, `src/renderer/intro/BootSequence.ts`).
  After a lost game `tag01efee` is CSBWin's own.
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole intro.** This is a
  developer affordance with no CSBWin counterpart, kept deliberately: eleven of the fourteen golden
  frames boot through it.
- 🚫 **Custom skins / `BACKGROUND_LIB`.** The shipped DM dungeon uses no custom
  backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here, so
  the branch is dead (`src/engine/PeriodicUpdates.ts:90`).
- 🚫 **Databases stop at 1024 records.** The port's `ObjectID` is the original's packed
  word, `[corner:2][database:4][index:10]`, so a record past 1023 cannot be named, and
  `DungeonState.findEmptyDBEntry` treats 1024 as `db.Max`: a full database falls back on
  `MakeMoreRoomInDB` (`src/engine/MakeMoreRoomInDB.ts`) at once. CSBWin first grows it by
  100 records at a time, up to 8000 (16000 for the actuators, 768 for database 15)
  (`doc/CSBwin-src/data.cpp:813-876`, `:967-972`, `CSB.h:1646`), and `SmartDiscard`, which
  starts at 6000 in use, therefore never acts here. The author's decision: 1024 is already
  more than the Atari original held (its databases were the file's records plus
  `Byte7302`'s spares, 420 for misc: `doc/PROVEN_FACTS.md`), and CSBWin's way past it is
  not wanted. **If it is ever needed:** CSBWin's `RN` is not the packed word but a 16-bit
  index into `dataIndexMap` / `dataTypeMap` (`doc/CSBwin-src/CSBTypes.h:265-341`), whose
  entries hold the record's index, its database and its corner; `FindEmptyDBEntry` hands
  out a slot of that map with the record (`data.cpp:919-993`), `DeleteDBEntry` frees both
  (`:995-1016`), and loading builds the map from the file's packed words. Porting it
  means every `decodeObjectID` / `encodeObjectID` / `withObjectPosition` and hand-written
  mask reading the map instead (about 240 places in 37 files), and working out how
  CSBWin's saves store the words.
- 🚫 **A drawn `RandomGameID` is never 0.** CSBWin keeps the product of its two draws
  whatever it is (`doc/CSBwin-src/SaveGame.cpp:1523-1532`), and it is 0 when either low
  word is, about one new game in 32768. The author's decision: the port draws the next
  pair instead (`drawRandomGameID`, `src/engine/GameContext.ts`), which in that case
  leaves the stream two draws further on than CSBWin's. 0 is what a save of an earlier
  build holds for no playthrough at all (`PLAN.md` → Phase 10, "A playthrough"), and the
  rule stays once no stored save holds it. `tools/dump-new-game.ts` checks it on a stream
  whose first pair gives 0.
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
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
