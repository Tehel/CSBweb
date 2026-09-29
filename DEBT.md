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

Tiers D and E are empty. **The goal now is a complete, faithful game on the default
dungeon** (`dm-atari`), so the unported features it needs come next, and whatever it does
not need waits.

The order, then:

1. **D and E.** New structural debt still goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** A divergence found along the way goes here and is
   taken before the G items: a known bug outranks a missing feature.
3. **G — Unported CSBWin features the default dungeon reaches**, in the index's order.
4. **The save menu rework** (`PLAN.md` → "Current priority"), once the active G rows are
   paid.
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
2. **Re-verify first.** Every pointer below was checked against the code on 2026-09-26, but
   line numbers drift. If an item turns out to be already paid, delete it and say how you
   know in the commit message.
3. **Refactors change no behaviour.** Tiers D and E are refactors: `npm test` before and
   after, and `npm test -- --frames` whenever anything under `src/renderer/` or `src/ui/`
   moves. Better still, and expected for any split of a module: every tool's full output is
   byte-identical before and after (only `dump-save-menu`, by one byte, and
   `dump-savegame`, by its payload's size, vary on their own: both carry the save's
   wall-clock date), and the author's runtime saves hash the same after load and
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
| C90 | `CheckCelltypes` and `CheckMonsters` are not run after a read | M | ⏳ |
| G16 | A compressed `dungeon.dat` | S | ⏳ |
| G18 | One game's data set, chosen before the boot | M | ⏳ |
| G17 | A new Chaos Strikes Back game: the prison and "MAKE NEW ADVENTURE" | M | ⏳ |
| G19 | Saves that know their dungeon | M | ⏳ |
| F3 | Phase 15 step 4 | — | in `PLAN.md` |
| G1 | DSA gaps | — | ⏸️ |
| G2 | Ten DSA filters | — | ⏸️ |
| G3 | The wings | — | ⏸️ |
| G4 | Custom-dungeon extensions: `talents`, malformed heroes, external portraits, the monster design options | — | ⏸️ |
| G14 | `AsciiDump`: the resumed game's "ASCII DUMP" | — | ⏸️ |
| G20 | The hint oracle | — | ⏸️ |
| X1 | Extra: drinking from a fountain with an empty hand | S | ⏸️ |
| X2 | Extra: a mastery just gained shown in green | S | ⏸️ |
| X3 | Extra: thrown weapons gathered back when the party walks over them | M | ⏸️ |
| H | Deliberate divergences | — | 🚫 |

The rows above G1 are the active list. The ⏸️ rows are postponed (see "Priority") and are
never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C91 · D11 · E8 · F12 · G21 · X4. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## D — State representation

Empty. New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

Empty. New architecture debt goes here, and jumps the queue.

---

## C — Known divergences from CSBWin

A divergence found along the way goes here, with the next free ID.

### C90 — `CheckCelltypes` and `CheckMonsters` are not run after a read

`_ReadEntireGame` calls `CheckCelltypes()`, `CheckMonsters()` and `ExtendPortraits()` once
the whole file is read (`doc/CSBwin-src/SaveGame.cpp:1825-1827`), for a new game and a
save alike, whatever its Extended Features block says. `ExtendPortraits` is ported
(`src/data/CsbwinDungeonConversions.ts`); the other two are not. They touch different
data from it and from each other, so their order does not matter.

- **`CheckCelltypes`** (`:1367-1400`) turns every cell whose room type is above 6 into
  open floor, keeping the low five bits. It changes nothing in DM, which has no such cell,
  and it can live in `DungeonLoader` beside `ExtendPortraits`.
- **`CheckMonsters`** (`:1342-1365`) walks every cell of every level and calls
  `CheckMonster` (`:1279-1340`) on each group, and on each group among its possessions.
  For a creature of `horizontalSize` 1 it cuts a group of more than two to two, and puts
  a pair whose two positions are not opposite (`pos1 ^ pos2 != 2`) at `groupIndex` 2;
  for size 2 it cuts the group to one and sets `groupIndex` 255. Each fix also sets
  `facing` 0. The two `UI_MessageBox` warnings are shown once per process. It needs
  `MonsterDescriptor`'s sizes, so it runs where the tables are, not in the loader.
  **To settle first:** it reads `groupIndex` as the packed positions, but in a save the
  groups on the party's level may hold an `ITEM16` index there (`DB4`'s comment in
  `src/data/dungeonTypes.ts`); check when CSBWin attaches them relative to this call before
  porting it as a plain walk.

DM's creature records come out of the DM Windows package's re-save unchanged
(`doc/PROVEN_FACTS.md` → "DM's two `dungeon.dat` files"), which suggests both are no-ops
on DM, but that is not a proof. The fix owes a `tools/` check that reports what each one
changes in `dm-atari/dungeon.dat`, the committed saves and CSB's `mini.dat`, and asserts
it on a record built to trip it.

---

## F — Verification debt

### F3 — Phase 15 step 4 stays in `PLAN.md`

The table-extraction round-trip checks are a live phase, so they stay in `PLAN.md` →
"Phase 15" rather than being copied here. The never-executed validation steps of phases 2,
4 and 7 are folded into it. Step 5, the comparison against CSBWin screenshots, is postponed
(see "Priority").

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. The active ones come in the index's order; the
postponed ones follow, under their own heading (see "Priority").

### G16 — A compressed `dungeon.dat`

`ReadDatabases` reads a new game's `dungeon.dat` through `ExpandData` when its first word
is 33028, and then takes `d.Word22592` from its word 3
(`doc/CSBwin-src/SaveGame.cpp:2346-2374`). `ExpandData` is about 66 lines with its
`getBits` helper (`CSBCode.cpp:9846-9929`): a 20-byte table of 4 and 16 entries, then
2-bit, 6-bit and 10-bit codes. Chaos Strikes Back's `dungeon.dat` is compressed: 2098
bytes opening `81 04`, the expanded size 2622, `Word22592` 12. It is the prison, two
levels with sentinel 8, where a CSB game begins (G17). `DungeonLoader` reads only a plain
file, and `newGameBlock1` (`src/engine/GameContext.ts`) keeps the 13 `_ReadEntireGame`
sets (`:1470`), where it should take the file's word. DM's `dungeon.dat` is plain.

### G18 — One game's data set, chosen before the boot

The page loads `dungeon.dat`, `graphics.dat` and `CSBgraphics.dat` from a fixed
`/gamefiles/dm-atari` (`src/main.ts`, `GAME_DATA_DIR`), builds `GameTables` and the sound
from that `graphics.dat` once, and every `Game` keeps them: `readNewGame` reuses
`this.ctx.tables`, and a loaded save is restored into the running game's tables. CSBWin
takes its rules from the data too. `DM_rules` aside, nothing in its code branches
on the game, and CSB's differences are the dungeon's content and the tables in its
`graphics.dat`. Measured against DM's: the same 563 items, 77 of them different (the
title's, portraits, and runs at 489-526 and 556-562), and 6 of the 35 tables
`buildGameTables` extracts (`monsterDesc`, `spells`, `skillNumber`,
`experienceForAttacking`, `byte20046`, `textDecode`). So a CSB save loaded into today's
page runs on DM's monsters and spells. The title animation and the credits read
`graphics.dat` too (graphic 1, `CSBCode.cpp:9205`), so the choice has to come before the
title. Item 0x231 is the long form in CSB's file (0x804 bytes, where DM's and Conflux's
are 0x7d4, `CSBCode.cpp:10135-10151`): `extractUITables` then reads `d.Buttons16932` from
it rather than `MISSING_PRISON_DOOR_BUTTONS`, and no data set has yet proven that path or
the offsets of the tables after it. That wants a canary. `static/gamefiles/csb/` holds
the CSB Windows package's `dungeon.dat`, `graphics.dat`, `mini.dat` and `csbgame2.dat`,
and no `CSBgraphics.dat`, which the package lacks too and CSBWin opens only on demand
for its extensions (`Graphics.cpp:1840-1858`, `:3201-3273`).

What is needed: a data set per game (a folder, its files, a name), chosen before
`loadGameFiles`, and everything built from it — the tables, the sound, the intro — with
nothing that assumes `dm-atari`. A `dungeon.dat` that carries an Extended Features block
(the DM Windows package's) sets `ctx.rules` through `readRulesOptions`, as a save does
(`doc/PROVEN_FACTS.md` → "`DM_rules` and `DMRulesDesignOption`…"); `DungeonLoader` reads
only a plain file today. The player's "DM Rules" toggle, which flips `ctx.rules.dmRules`
(`CSBUI.cpp:912-914`), goes on the page with the chooser. **Where to choose (the author's decision): on the
page**, a chooser outside the game that reloads it with, say, `?dungeon=csb`. That is where
CSBWin makes the same choice, from the command line's `directory=` or `config.txt`'s
`DIRECTORY` (`CSBUI.cpp:2032`, `:799`), and its launcher `_AskWhatToDo` offers no dungeon
(`CSBCode.cpp:11338-11444`). A reload also rebuilds every boot-time structure for free,
where an in-game switch would have to rebuild the tables, the sound and the screen's
caches in place. Conflux (`static/gamefiles/conflux-3.5-b8/`)
is not a data set yet: its 620 KB `dungeon.dat` does not open with 33028 and does not
parse, and nothing has examined its format.

### G17 — A new Chaos Strikes Back game: the prison and "MAKE NEW ADVENTURE"

CSBWin makes a CSB game in three steps (the utility's own header,
`doc/CSBwin-src/Chaos.cpp:1-5`):

1. **DUNGEON → Enter** reads `dungeon.dat`, the prison (G16), and the party is saved from
   it as `CSBGAMEn.DAT` (`SaveGame.cpp:902-908`). Where the champions are chosen in it is
   not yet traced; the prison has to be decompressed first.
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
   block, loads (`tools/dump-atari-saves.ts`).

A DM party can therefore be carried into CSB, which is the classic way to play it.
**How the port offers step 2 (the author's decision): its engine only.** Port the
checks and `TAG002724`'s copy, and run them from the page or the save menu on a chosen
source save, writing a new save. The utility's screen is not ported, and step 2 is not
run automatically when the prison's party is saved.

### G19 — Saves that know their dungeon

A save's header names its date, level and party, not its game (`SaveHeader`,
`src/engine/SaveGamePayload.ts`), and both stores list every save together, so a DM save
could be offered to a CSB game and restored into the wrong tables. CSBWin keeps a game's
saves in that game's directory (`CSBGAME.DAT` to `CSBGAME4.DAT`, `CSBCode.cpp:9747-9756`),
and it guards against the wrong graphics with the signatures an Extended Features block
may carry (`expectedGraphicSignature1/2`, `SaveGame.cpp:378-379`, checked at
`Graphics.cpp:1784-1815`), which the port neither checks nor writes. Needed: saves stored
and listed per data set (G18), a genuine `.dat` accepted in the set whose files it was
made from, and G17's source save picked across sets (a DM save feeds a CSB game). It
belongs with the save menu rework (`PLAN.md` → Phase 10, step 11).

### Postponed until the default dungeon is validated

Not taken in order; the author names one to start it (see "Priority").

### G1 ⏸️ DSA gaps

- **Opcodes.** Unimplemented DSA opcodes and `&` subcodes are reported once each through
  `warnedOps` (`src/engine/DsaSystem.ts:1261`, `:1865`). Those warnings are the list.
  Slave DSAs are not implemented (`findMaster`, `:1909-1917`).
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
  `buildSavePayload` refuses a dungeon that defines one rather than write a file without
  them (`src/engine/SaveGamePayload.ts`), and `saveSaveGameState` writes a loaded save's
  DSA section back verbatim (`SaveGameState.dsaBlock`), where a DSA whose state has moved
  since the load would be written as it stood.
- **`ECF_FOOTPRINTS`.** The footprint arm of `SummarizeRoomInfo` also shows prints on any
  cell with this extended cell flag once `d.Time > 0` (`Codea59a.cpp:419-425`). Only a
  DSA or a custom dungeon sets extended cell flags. The magic footprints are drawn
  (`src/renderer/csbwin/SummarizeRoomInfo.ts`, beside a comment naming this item).

### G2 ⏸️ Ten DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:112`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:346`).
- `ProcessMonsterDeleteFilter` (`Code11f52.cpp:926`). It counts each kill in `expool`'s
  statistics and, when the dungeon has an `ESL_DELETEMONSTERFILTER`, runs its type-47 DSA,
  which may set `deathCloud` and `dropResidue`. CSBWin calls it from `DamageMonster` with
  `DMW_Damage` (`Code11f52.cpp:1112`, `:1122`) and from `MoveObject`'s two deletions with
  `DMW_Movement1` / `DMW_Movement2` (`:3151`, `:3304`). The port's matching places are
  `MonsterDamage.ts:463` and `MonsterSystem.ts:546`.
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

**Two save-file matters.** `SimpleEncryption` (`EF_FLAGS` 0x04) puts the whole file behind
RC4 with the key `{1,0}`, and CSBWin sets it only when it reads a file already enciphered
(`doc/CSBwin-src/SaveGame.cpp:326-338`); the reader deciphers the 512-byte header and no
more, and the writer never sets it. And `MakeBigActuators` reads each actuator's type before
the byte swap, so CSBWin takes bits 8-14 of `word2` for it where the port takes the type
(`doc/PROVEN_FACTS.md` → "`MakeBigActuators` runs before the byte swap");
`tools/dump-dungeon-conversions.ts` fails if a dungeon has a type-47 actuator under either
reading, and DM has none.

**The monster design options.** `DB4::invisible()` is gated on `invisibleMonsters`, and
`drawAsSize4()`, `Unique()` and `Poisoned()` on `drawAsSize4Monsters`
(`CSB.h:1125-1132`). Both options are read from a save's `extendedFlags`
(`SaveGame.cpp:394-400`, `false` by default). The port models neither: `CreatureRecord`
holds the raw bits, and `monster.drawAsSize4` is read ungated in
`MissileEncounter.processMissileEncounter` (`MissileEncounter.ts:371`) and in `MonsterDamage`
(`:504`, `:540`). Only `monsterUnique` (`MonsterSystem.ts:69`) applies a gate, as a
constant `false`. Harmless for now, because no creature in `dm-atari/dungeon.dat` sets any
of bits 11-14. Modelling it means reading `extendedFlags & 0x02` / `& 0x04` in
`SaveGameLoader` and gating every accessor.

### G14 ⏸️ `AsciiDump`: the resumed game's "ASCII DUMP"

`AsciiDump` (`doc/CSBwin-src/AsciiDump.cpp:2137`) writes the whole dungeon as text to
`ASCIIDUMP.TXT`, starting with the game's and the levels' information, every cell, the
objects, and the monsters (`:2152-2160`). The one route to it is the second button of the
"GAME LOADED, READY TO PLAY." menu (`CSBCode.cpp:10497-10515`), which in the port only puts
the menu up again (`tag021028`, `src/renderer/intro/BootSequence.ts`). In a page it would be
a download.

### G20 ⏸️ The hint oracle

CSBWin's HINT choice (`_StartHint`, `doc/CSBwin-src/Hint.cpp:6454`, a 7936-line file)
reads `hcsb.hct` and `hcsb.dat`, deciphered with RC4 under the `hintKey` of a save's
Extended Features block (`:5401-5628`, `SaveGame.cpp:382`), and answers questions about
a CSB game in progress. It is not the game, so it waits; the author names it to start it.

---

## X — Extras (not in CSBWin)

Features from later versions of the game or from elsewhere, which the author wants once
the default dungeon is validated. Postponed (⏸️) like the G items below "Postponed", and
taken only when the author names one.

Rules for all of them:

- **One setting, off by default**, a `UISettings` flag (`src/ui/settings.ts`) that the
  first extra paid adds and the others share. With it off, the game is CSBWin's: every
  tool's output and every golden frame stay the same.
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
`tryUseFrontWallItem` (`src/renderer/ui/ViewportPicking.ts:135`), which returns at once
when the hand is empty.

The extra: with an empty hand, the **cursor owner** drinks. That is the same drink as one
gulp from a full waterskin: `waterValue = 800` and `SOUND_GULP` (`computeFeedParameters`,
`src/renderer/ui/Feeding.ts:57-66`), applied through `applyFeeding`, so the water cap
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
  held in slot 0 through `MagicSystem.launchObject` (`src/engine/MagicSystem.ts:540`).
  `launchObject` also launches spells, so the object is tagged in the attack, not there.

A thrown object keeps its `ObjectID` all the way: in the missile's `projectileObject`,
on the floor where it lands, and in a monster's possessions when a hit absorbs it
(`MissileEncounter.ts:434`), which the monster drops when it dies. So a tag table
`ObjectID → { champion, slot }`, filled at the throw, follows it without any further
work.

Needed:

- **The trigger.** When the party arrives on a cell, after that cell's actuators have
  fired, take every tagged object lying there. Arrival covers the stairs, pits and
  teleporters (`src/engine/WorldMove.ts`) as well as a step.
- **Taking it the proper way.** The object comes off the floor through the same
  remove-from-cell path as a pickup by hand, so a pressure plate under it still fires.
- **Putting it back.** Into the slot it left if that is empty and the object's carry
  mask allows it there (`objDescCarryMask`). Otherwise into the first free slot that
  allows it (quiver, then pack). The load is recomputed from the possessions (H). If the
  thrower is dead or has no room, the object stays on the floor, keeping its tag.
- **Dropping tags.** A tag goes when the object is picked up by hand, and when its
  record is freed (`deleteDBEntry`, `SmartDiscard`, `MakeMoreRoomInDB`). A freed record
  handed out again must not inherit it. Every writer of `objectInHand` and every caller
  of `deleteDBEntry` is found by grep, as for any empty value (`CLAUDE.md` → "Object IDs").

A `watch-*.ts` tool proves it: throw and shoot at a wall and at a monster, kill the
monster, walk onto the cell, and check the inventory, the floor chain and the load.

---

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

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
  ends, the port's does before it. Both scripts end the game, and the callers' tails that
  anything could still see are skipped (`executeAttack` and `handleAttackAreaClick`,
  `src/renderer/ui/Attack.ts`). What is left is `HandleMouseEvents`' `lastTime = d.Time`
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
- 🚫 **`?intro=0`, and Debug in the saved UI settings, skip the whole intro.** This is a
  developer affordance with no CSBWin counterpart, kept deliberately: eleven of the fourteen golden
  frames boot through it.
- 🚫 **Custom skins / `BACKGROUND_LIB`.** The shipped DM dungeon uses no custom
  backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 **The `d.Word11750` countdown** in `TenSecondUpdate` is not ported. It is a
  cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no counterpart here, so
  the branch is dead (`src/engine/PeriodicUpdates.ts:88`).
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
- 🚫 **Audio sample rates**, a documented exception to faithfulness:
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- 🚫 **Crack Switch (In) placement.** `Byte4100[55]` is read as 2, not `graphics.dat`'s 0,
  so a pressed crack switch stays low on the wall as in the Atari ST original:
  `doc/PROVEN_FACTS.md` → "Crack Switch (In) placement".
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - The giant `switch`es in `DsaSystem.execute` / `executeAmpersand`,
    `BytecodeInterpreter.executeOpcode` and `AttackSystem.attack` mirror the C++ switches
    line by line, and should stay that way.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
