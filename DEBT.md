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
unported features it needs come next, and whatever it does not need waits. Two pieces
of work follow it, the author's next challenges: a redesigned page, and a second dungeon
(Chaos Strikes Back first). Tiers D and E hold what the
code needs before them: a base solid enough to build them on. `E15` is the page
redesign's first step.

**Conflux 3.5** (`static/gamefiles/conflux-3.5-b8/`) is the third dungeon, and the work it
needs is in the active list: G23, G1 to G4, G24, G25, G27 and G26. G23 comes
first: until the whole file is deciphered, nothing else on that path can be checked
against the dungeon. Each entry says what Conflux uses of it, measured on the deciphered file.
DSA support is aimed at whole, not at Conflux's share of it: G1 is every operation CSBWin
has, so G27 is on the path though Conflux's programs never call `&GETSKIN`.

The order, then:

1. **D and E.** New structural debt still goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** A divergence found along the way goes here and is
   taken before the G items: a known bug outranks a missing feature.
3. **G — Unported CSBWin features the default dungeon reaches**, in the index's order.
4. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**Postponed (⏸️) until the default dungeon is validated.** These are not taken in order,
and no session picks one up unless the author names it:

- **A save of a dungeon the port does not know** (G22).
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
| C116 | Three of the prison's mirrors give no champion | S | ⏳ |
| G23 | Enciphered files: the whole of a `dungeon.dat`, and the saves of its game | S | ⏳ |
| G1 | Full DSA support: every operation, slave DSAs, and a save of a dungeon with DSAs | L | ⏳ |
| G2 | Thirteen DSA filters | L | ⏳ |
| G3 | The wings | M | ⏳ |
| G4 | Custom-dungeon extensions: `talents`, malformed heroes, external portraits, the monster design options | M | ⏳ |
| G24 | `CSBgraphics.dat`'s portraits, sounds and alternate monster graphics | M | ⏳ |
| G25 | Viewport overlays and overlay palettes | M | ⏳ |
| G27 | Skins: a cell's own wall, floor and ceiling graphics | L | ⏳ |
| G26 | Conflux 3.5 as a data set | M | ⏳ |
| G28 | The utility's two untried forms: a word-10 saved game, a `mini.dat` with an Extended Features block | S | ⏳ |
| E15 | The page shell | L | ⏳ with the page redesign |
| F12 | The tools' scaffolding is copied, and reaches privates through unchecked casts | M | ⏳ |
| F13 | `npm test` runs its tools one at a time | S | ⏳ |
| F3 | Phase 15 step 4 | — | in `PLAN.md` |
| G14 | `AsciiDump`: the resumed game's "ASCII DUMP" | — | ⏸️ |
| G20 | The hint oracle | — | ⏸️ |
| G21 | `Translation.txt`: the messages the executable prints, translated | — | ⏸️ |
| G22 | An unknown dungeon played from its save | — | ⏸️ |
| X1 | Extra: drinking from a fountain with an empty hand | S | ⏸️ |
| X2 | Extra: a mastery just gained shown in green | S | ⏸️ |
| X3 | Extra: thrown weapons gathered back when the party walks over them | M | ⏸️ |
| X5 | Extra: 3D2D1D's vertical moves and gravity | L | ⏸️ |
| X6 | Extra: the Hint Oracle's hints in the game, as the party moves | M | ⏸️ |
| H | Deliberate divergences | — | 🚫 |

The rows above G14 are the active list. `F3` is a phase, whose status is
`PLAN.md`'s. One row sits
out of its tier's place on purpose: `E15` below the G rows, because it waits for the page
redesign to start: a session that reaches it first asks the author, and takes the next
row meanwhile. The G rows from G23 on are Conflux's (see "Priority"). The F
rows are independent of the rest ("Priority", point 4), so they can be taken anywhere.
The ⏸️ rows are postponed (see "Priority") and are never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C117 · D17 · E21 · F14 · G29 · X8. An ID recorded and paid in one commit has no
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

### C116 ⏳ Three of the prison's mirrors give no champion

CSB's prison has 24 mirrors on level 0 (`doc/PROVEN_FACTS.md` → "A compressed
`dungeon.dat`: CSB's prison"), and `extractPresetHeroes` (`src/data/HeroExtractor.ts`)
reads a champion for 21 of them. It rejects the texts behind three, so a click on those
mirrors does nothing: `findHeroForMirror` finds no hero and `addCharacter` returns
(`src/engine/HallOfChampions.ts`).

| Mirror | Value | Text, at | As `tools/peek-dungeon.ts dump 0` prints it |
| --- | --- | --- | --- |
| (13,2), east face | 8 | (14,2) | ` / MANTIA SPELLWEAVER OF KE LT F AAMIAILGAAKN …` |
| (17,2), west face | 10 | (16,2) | ` / SLOGAR WEBBER OF ARACHNI A F AAPKAKFKAAEG …` |
| (10,11), north face | 7 | (10,10) | ` / VEN HIGH PRIEST OF SS HA M AAMPAGKEAAJG …` |

In the 21 others the printout shows a line break between the title and the gender letter;
in these three it shows none. What CSBWin's `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`)
makes of these texts is not traced yet: trace its reading of the name, the title and the
gender, then the `legalHero` fallback (`:475`, `G4`), before changing the extractor.

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

`tools/run-checks.mjs` spawns its 134 checks sequentially (`spawnSync`, `:258`), each a
`tsx` start of 300 ms or more, so the gate takes over a minute (the ~80 s `CLAUDE.md`
and the runner's header give). Most sessions run it several times. Paying it means a pool
of workers the size of the machine, the output still printed in the list's order, and
those timings updated.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. The active ones come in the index's order; the
postponed ones follow, under their own heading (see "Priority").

### G28 ⏳ The utility's two untried forms: a saved game unscrambled with word 10, and a `mini.dat` with an Extended Features block

`src/engine/Chaos.ts` refuses both, so a file of either form makes no adventure:

- `_ReadSavedGame` unscrambles `GAMEBLOCK1` with word 29 and, if that fails, with word
  10 (`doc/CSBwin-src/Chaos.cpp:2359-2378`), a form whose block keeps the hashes at 310
  and the checksums at 342, and whose `TAG00260e` and `TAG002724` branches read other
  offsets (`:2531-2538`, `:2602-2617`). Nothing else in CSBWin reads that form, the
  port's reader does not, and no file of it is here. `ReadSavedGame` reports it as
  damaged (message 14).
- `_TAG000fc4` writes a new Extended Features block when `mini.dat` opened with one
  (`:1738-1793`), from the globals the read left, with `BigActuators` set whatever the
  file had and no `cellFlagArraySize`. CSB's `mini.dat` has none. `TAG000fc4` throws.

Paying it needs a file of each form, or the author's decision to port them unchecked.

### G23 ⏳ Enciphered files: the whole of a `dungeon.dat`, and the saves of its game

`SimpleEncryption` (`EF_FLAGS` 0x04) puts the whole file, a save or a `dungeon.dat`, behind
`RC4.cpp`'s cipher (`doc/PROVEN_FACTS.md` → "The "simple" encipherment is `RC4.cpp`'s own
cipher"). `readExtendedFeatures` deciphers the 512-byte block and no more, so an
enciphered file fails at its object maps. CSBWin's `READ` deciphers every buffer by its
position in the file (`doc/CSBwin-src/system.cpp:301-313`), and `WRITE` enciphers the same
way (`:315-329`). CSBWin sets the flag only when the file it read was enciphered
(`SaveGame.cpp:326-338`), and `SaveGame` keys the same cipher (`:915-918`), so a save of
such a game is enciphered too. The port's writer never sets the flag.

Paying it: decipher the whole file once the block says so, and write a save enciphered
when its game's file was. Conflux 3.5's `dungeon.dat` is the canary
(`tools/dump-extended-features-read.ts`), and the check is that file read to its end. Its
index has 19925 slots, and five of its databases run past record 1023, which only a
database that grows to `db.Max` holds (`DungeonState.enlarge`):

| Database | Records | Slots past 1023 |
| --- | --- | --- |
| actuators | 10318 | 9287 |
| texts | 2243 | 1197 |
| misc | 1631 | 592 |
| teleporters | 1613 | 575 |
| creatures | 1257 | 228 |

### G1 ⏳ Full DSA support: every operation, slave DSAs, and a save of a dungeon with DSAs

The goal is the whole of CSBWin's DSA, not what one dungeon calls. Every command is
ported, but for `DSACMD_RANDOM` (10), which has no case in CSBWin's interpreter either. Of
CSBWin's 138 `&` operations (`STKOP_*`, `doc/CSBwin-src/Data.h:1723`), the port has 55,
so 83 are left.

Conflux, the dungeon that will check them, defines 131 DSAs, with 4646 programs, behind
1591 type-47 actuators. A static census of its programs decodes each word with the
operand layout `DsaSystem.execute` reads, and every program decodes to its exact length.
It uses 118 `&` operations, 73 of the 83. With Conflux's count of each:

- **Characters**: `CharFetch` 67, `CharStore` 24, `I_CharStore` 4, `ChPoss` 107, `Mastery`
  71, `ExperiencePlus` 33, `WhereIsChar` 61, `IsCarried` 35, `PartyFetch` 36,
  `CharNameFetch` 3, `CountInjury` 1, `CausePoison` 1, `I_CausePoison` 6. `SwapCharacter` 7
  and `I_SwapCharacter` 4 need G3, and `WhoHasTalent` 5, `TalentsFetch` 2 and
  `TalentsStore` 2 need G4's `talents`.
- **Objects**: `GetCharges` 32, `SetCharges` 45, `GetCurse` 6, `SetCurse` 3, `GetBroken` 3,
  `SetBroken` 3, `GetPoisoned` 4, `GetSubType` 24, `SetSubType` 11, `MissileInfoFetch` 2,
  `MissileInfoStore` 2, `Throw` 1, `I_Throw` 14, `Cast` 2, `I_Cast` 2, `FilteredCast` 3,
  `CreateCloud` 10, `I_CreateCloud` 59.
- **Monsters**: `MonsterFetch` 27, `MonsterStore` 12, `I_MonsterStore` 6, `MonPoss` 3,
  `MonBlk` 1, `MonLandD` 1, `I_DelMon` 2, `I_InsMon` 2.
- **Text and sound**: `Message` 62, `Say` 121, `TextFetch` 7, `GlobalTextStore` 16,
  `DiscardText` 1, `Sound` 308 (whose samples are G24's).
- **The dungeon and the program**: `I_Del` 42, `I_Add` 41, `I_Move` 17, `I_CellStore` 4,
  `I_Indirect` 1, `I_Delay` 22, `FetchExCellFlg` 2, `StoreExCellFlg` 1, `ThisCell` 11,
  `Neighbors` 4, `Loc2AbsCoord` 51, `PartyDistance` 5, `JumpGear` 8, `GosubGear` 8,
  `ThisDSAId` 4, `DSAInfoFetch` 3, `BitCount` 3, `MultiplierFetch` 1, `VSET` 1, `Jitter` 7,
  `DisableSaves` 2.
- **The display**: `Overlay` 25 and `Palette` 5, which need G25.

The ten Conflux never calls: `Noop` (0: the port's `StkOp` names it but has no case, so it
traces as unimplemented), `2Dup` (23), `SetPoisoned` (75), `I_Copy` (87), `DelMon` (95),
`InsMon` (96), `TextSay` (104), `I_FilteredCast` (120), and `GetSkin` (131) and `SetSkin`
(132), which need G27. No dungeon here checks these against play, so each is ported with
a tool of its own.

Every `I_` operation but two is CSBWin's `Indirect`: it packs the operation and its
operands into a record and sends it to the DSA at `ESL_INDIRECTACTIONS`, whose `I_Indirect`
unpacks and runs it (`doc/CSBwin-src/DSA.cpp:2093-2130`, `:2346-2364`, `:4957-4971`). That
filter is G2's. `I_Delay` sets the delay of the next one (`:4972`), and `I_Indirect` is the
unpacking.

The steps: first the census as a tool. It prints, against CSBWin's `STKOP` list, every
operation the port lacks, with a dungeon's count of each when given one, and fails while
any is left. Then one family per commit, in the order above, the ten with their nearest
family. Last, `DSA::Write` and the `EXPOOL` records, so that a game with DSAs can be
saved (below). Until G23 is paid, no operation can be checked against Conflux.

The rest of the item, with two operations that need care when ported:

- **Slave DSAs** are not implemented (`findMaster`, `src/engine/DsaSystem.ts`).
- **Unported opcodes are traced** once each through `warnedOps` (`DsaSystem.ts`), for a
  dungeon the census has not seen.
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
  since the load would be written as it stood. The retail DM dungeon defines none:
  `numDSA` is 0 in every save of `tools/fixtures/`, with no special-location records.
- **What a DSA keeps in a save's `EXPOOL`.** `SaveGame` writes the DSA global variables
  there, sixteen to a record (`doc/CSBwin-src/SaveGame.cpp:1141-1148`), and `LoadGame`
  reads them back (`:1746-1763`); the port does neither, and a load keeps the running
  game's (`src/engine/CsbwinSaveGame.ts` → "What is not restored"). `SaveGame` also
  writes the overlay palette there at every save, as 24 records (`:1152-1164`), which
  `LoadGame` takes when all 24 are found (`:1763-1789`). Only a DSA changes that
  palette: `SetOverlayPalette` has one caller (`DSA.cpp:2942`), and it is the identity
  otherwise (`ClearOverlayPalette`, `data.cpp:117`, at `CSBCode.cpp:482`). The port
  models no overlay palette and writes no such record. And CSBWin's `Setup` gives every
  loaded game the pool's directory block (`SaveGame.cpp:2773`), where the port makes it
  at the first record it writes, a death's bones (`src/data/CsbwinExpool.ts`). So the
  port's save of a game started on `dungeon.dat` has no `EXPOOL`, or the bones' alone,
  where CSBWin's has the block and 24 identity records. CSBWin loads either: `Setup`
  makes the block, and with no palette record it keeps the palette it has.
- **`ECF_FOOTPRINTS`.** The footprint arm of `SummarizeRoomInfo` also shows prints on any
  cell with this extended cell flag once `d.Time > 0` (`Codea59a.cpp:419-425`). Only a
  DSA or a custom dungeon sets extended cell flags. The magic footprints are drawn
  (`src/renderer/csbwin/SummarizeRoomInfo.ts`, beside a comment naming this item).

### G2 ⏳ Thirteen DSA filters

The port runs five filters: the viewing filter, the party attack filter, the adjust
skills filter, the missile encounter filter, and the spell filter at
`spellFilterLocation`. Each place below uses CSBWin's defaults instead. Conflux's `EXPOOL`
names a location for all sixteen special locations, `ESL_MONSTERATTACKFILTER` (0) to
`ESL_DAMAGECHARFILTER` (15, `doc/CSBwin-src/CSB.h:1535-1550`), and a spell filter, so it
reaches every filter here but the portrait one. Whether a DSA actuator stands at each
location waits for G23, as the chains cannot be read before it.

- `ESL_MONSTERMOVEFILTER` (`doc/CSBwin-src/Monster.cpp:3080-3130`), which a level can
  have its own of: the key with `(level + 1) << 8` is tried first, then the dungeon's.
- `ESL_INDIRECTACTIONS`, the DSA every `I_` operation is sent to (`DSA.cpp:2093-2130`,
  G1). The port's `I_TELEPORT_PARTY` teleports at once, as `TeleportParty` does
  (`DsaSystem.ts`, `case StkOp.I_TELEPORT_PARTY`), where CSBWin's sends a record to that
  DSA (`DSA.cpp:4963`). It is corrected with this filter: no dungeon the port plays
  reaches it.

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

### G3 ⏳ The wings

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
party. Conflux does: `SwapCharacter` 7 times and `I_SwapCharacter` 4 (G1).

### G4 ⏳ Custom-dungeon extensions: `talents`, malformed heroes, external portraits, the monster design options

- `pcA3->talents`, which `Champion` has no field for. `AddCharacter` decodes it from the
  hero text (`Character.cpp:688`), and only a DSA reads it (`DSA.cpp:4220`, `:4287`,
  `:4337`);
- the `legalHero` fallback (`Character.cpp:475`), which clamps an out-of-range hero text
  and retries it against "BOGUS / ILLEGAL HERO", where `HeroExtractor` rejects it
  outright;
- external portraits for `charID > 23`.

No shipped DM hero touches any of these. Conflux does: its DSAs read and write `talents`
(G1), and three of the 22 heroes `HeroExtractor` reads from it have portraits 274, 275 and
276, which come from `CSBgraphics.dat` (G24). Whether it rejected a malformed one is not
checked.

**A file matter, off Conflux's path.** `MakeBigActuators` reads each actuator's type before
the byte swap, so CSBWin takes bits 8-14 of `word2` for it where the port takes the type
(`doc/PROVEN_FACTS.md` → "`MakeBigActuators` runs before the byte swap");
`tools/dump-dungeon-conversions.ts` fails if a dungeon has a type-47 actuator under either
reading, and DM has none. The conversion runs only on a file without the `BigActuators`
flag (`doc/CSBwin-src/SaveGame.cpp:2604`), and Conflux's has it.

**The monster design options.** `DB4::invisible()` is gated on `invisibleMonsters`, and
`drawAsSize4()`, `Unique()` and `Poisoned()` on `drawAsSize4Monsters`
(`CSB.h:1125-1132`). Both options are read from a save's `extendedFlags`
(`SaveGame.cpp:394-400`, `false` by default). The port models neither: `CreatureRecord`
holds the raw bits, the renderer's `DrawRoomObjects` / `DrawMonster` take both options as
false (every creature drawn, never `DrawSize4Index`), and `monster.drawAsSize4` is read ungated in
`MissileEncounter.processMissileEncounter` (`MissileEncounter.ts:373`) and in `MonsterDamage`
(`:504`, `:540`). Only `monsterUnique` (`MonsterSystem.ts:70`) applies a gate, as a
constant `false`. Harmless on DM, because no creature in `dm-atari/dungeon.dat` sets any
of bits 11-14. Conflux sets both options (`extendedFlags` 0x76), and of its 1257 creature
groups 3 are invisible, 372 drawn as size 4 and 194 unique. Modelling it means reading `EF_EXTENDED_FLAGS.InvisibleMonsters` and
`DrawAsSize4Monsters` in `readExtendedFeatures` and gating every accessor.

### G24 ⏳ `CSBgraphics.dat`'s portraits, sounds and alternate monster graphics

CSBWin reads eight kinds of section from `CSBgraphics.dat` (`CGT_*`,
`doc/CSBwin-src/CSB.h:289-296`). The port reads two, the wall and the floor decorations
(`src/data/CSBGraphicsLoader.ts`). Conflux's file holds 156 portraits, 611 sounds, 123
alternate monster graphics, 90 backgrounds, 112 viewport overlays, 51 overlay palettes, 36
wall and 72 floor decorations. Of the six kinds the port does not read, Conflux reaches:

- **Portraits** (`doc/CSBwin-src/Bitmaps.cpp:287`): its heroes with portraits past 23 (G4).
- **Sounds** (`Sound.cpp:996`): what its 308 `&SOUND`s play (G1).
- **Alternate monster graphics** (`Code51a4.cpp:1097`): 598 of its creature groups have
  `alternateGraphics` 1 to 3.

The overlays and their palettes are G25, and the backgrounds, which are what a skin
draws, G27.
CSBWin also checks the file's signature against the one the dungeon's Extended Features
block names (`SaveGame.cpp:380`, `Graphics.cpp:1865-1881`).

### G25 ⏳ Viewport overlays and overlay palettes

A DSA lays an image over the viewport with `&OVERLAY` (`SelectOverlay`,
`doc/CSBwin-src/Bitmaps.cpp:687`, read by `OVERLAYDATA::ReadOverlay`, `:572`), and tints it
with `&PALETTE` (`SetOverlayPalette`, `:651`; `OVERLAYDATA::CreateOverlayTable`,
`Graphics.cpp:2978`). `WinScreen.cpp` composes the result. Both read their data from
`CSBgraphics.dat`. The overlay in force travels in the Extended Features block
(`OverlayActive`, `overlayOrdinal`, `overlayP1`-`P3`, `CSB.h:491-505`), and the overlay
palette in `EXPOOL`, as 24 records (G1, "What a DSA keeps in a save's `EXPOOL`"). The port
models neither. Conflux's DSAs call `&OVERLAY` 25 times and `&PALETTE` 5 times.

### G27 ⏳ Skins: a cell's own wall, floor and ceiling graphics

A CSBWin cell has a skin number, which the viewport's drawing programs read
(`CurrentSkin`, `SkinNumber`, `doc/CSBwin-src/Viewport.cpp:3028-3032`). Through
`BACKGROUND_LIB` they turn it into the IDs of the wall, floor, middle and ceiling graphics
and their masks, and of a skin's wall decoration (`:3035-3061`). Those are read from
`CSBgraphics.dat`'s background sections (`CGT_Backgrounds`, `BACKGROUND_LIB::FindGraphicInCache`,
`:5801-5830`). A DSA reads and sets a cell's skin with `&GETSKIN` and `&SETSKIN`
(`DSA.cpp:3107`, through `skinCache`). The port has none of it: `DrawViewport` gives every
cell skin 0 (`src/renderer/DrawViewport.ts`, "Default skin for prototype"), and its
interpreter has none of the background opcodes. Where a cell's skin is kept between DSA
calls and in a file is not yet traced. Conflux's file holds 90 background sections, and
its programs never call `&GETSKIN` or `&SETSKIN`. Whether its cells carry skins is part of
the tracing.

### G26 ⏳ Conflux 3.5 as a data set

Once the items above are paid, what is left is the page's side:

- a `DATA_SETS` entry with `csbGraphics` (`src/data/DataSets.ts`), and a `KNOWN_DUNGEONS`
  signature from `tools/dump-dungeon-signature.ts` (`src/data/DungeonSignature.ts`). The
  comments in both that say why Conflux is missing go with them;
- **its `graphics.dat`**, 456953 bytes where DM's is 271921. Its tables extract without an
  error, and nothing has looked at them further. Its levels name graphics past DM's: wall
  decorations up to 192, floor decorations up to 108, door decorations up to 56, and
  monster types up to 40 (DM's: 59, 8, 11 and 26). Its creature records use types 0 to
  26 only. What CSBWin does with a level's monster type past 26 is not traced;
- a golden frame at Conflux's start, and a tool that plays its first ticks.

Its `AutoRecord` flag (0x10) asks CSBWin to record the game for playback, which is not
the game; whether to model it is the author's call.

### Postponed until the default dungeon is validated

Not taken in order; the author names one to start it (see "Priority").

### G14 ⏸️ `AsciiDump`: the resumed game's "ASCII DUMP"

`AsciiDump` (`doc/CSBwin-src/AsciiDump.cpp:2137`) writes the whole dungeon as text to
`ASCIIDUMP.TXT`, starting with the game's and the levels' information, every cell, the
objects, and the monsters (`:2152-2160`). The one route to it is the second button of the
"GAME LOADED, READY TO PLAY." menu (`CSBCode.cpp:10497-10515`), which the port does not
put up (`tag021028`, `src/renderer/intro/BootSequence.ts`;
`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port"), so it would need
a route of its own. In a page it would be a download.

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

### G22 ⏸️ An unknown dungeon played from its save

CSBWin resumes any save its directory holds, with that directory's `graphics.dat`. The
port's import refuses a save of a dungeon it does not know, and of a known one no data
set plays (`doc/SAVES.md` → "An import is checked against the dungeon"). Playing one
would be a further answer on that refusal, of use to someone working on a dungeon of
their own. A save is its dungeon's whole world and already loads into any running game
(`installCsbwinWorld`), so what is missing is what the file does not hold: the graphics
and the tables read from `graphics.dat`, which the player would pick from the known
dungeons' (the signatures an Extended Features block may carry,
`doc/CSBwin-src/SaveGame.cpp:378-379`, could suggest one); a `dungeon.dat` for "RESTART
THIS GAME", so a lost game can only load a save; and a data set to list its saves under,
which its signature can stand for. A dungeon with DSAs waits for G1: `buildSaveFile`
refuses to save one.

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
  was over (`doc/CSBwin-src/CSBCode.cpp:1498-1502`, `:1682-1685`). That the Atari
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
  (`doc/CSBwin-src/Mouse.cpp:1647-1649`), stamped at the click, which nothing reads after
  the credits.
- 🚫 **A champion carried into a new adventure keeps their sex.** `TAG002724` masks
  `charFlags` with `LE16(LE16(wordGear(+48) & 16))`, which on the little-endian build
  keeps 0x1000 of the file's word and clears `CHARFLAG_male`
  (`doc/CSBwin-src/Chaos.cpp:2644`). Nothing in CSBWin reads the flag, so it shows
  nowhere; the author's decision is to keep it all the same. The port keeps
  `CHARFLAG_male` and clears the rest, as the mask reads (`TAG002724`,
  `src/engine/Chaos.ts`; `tools/dump-new-adventure.ts`).
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
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here, so
  the branch is dead (`src/engine/PeriodicUpdates.ts:90`).
- 🚫 **A drawn `RandomGameID` is never 0, nor a stored save's.** CSBWin keeps the
  product of its two draws whatever it is (`doc/CSBwin-src/SaveGame.cpp:1523-1532`), and
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
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
