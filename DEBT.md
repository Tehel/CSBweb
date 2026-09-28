# dmweb – Technical debt

This file is the **authority on technical debt**: everything known to be wrong, divergent
from CSBWin, duplicated, or left unfinished in code that is otherwise considered done. It
lists **open items only**. `PLAN.md` carries the live phases and points here; paying this
list off is the current project priority (`PLAN.md` → "Current priority").

A paid item is deleted. Its commits name its ID, so `git log --grep C33` finds the work,
and an ID is never reused. Items paid before 2026-09-26 are in `doc/PLAN_ARCHIVE.md` →
"Resolved debt", which is where a `DEBT.md` ID cited in the code but absent here is found.

Markers are `PLAN.md`'s: ⚠️ knowingly divergent or incomplete · ⏳ not started ·
🚫 deliberately not done.

## Priority: structure before features

**Data-structure and architecture debt is paid before any missing feature is built.**
Tiers D (state representation) and E (architecture) come first, then the divergences of
tier C, and the unported features of tier G come last. Two reasons:

- A feature built on a structure that is about to move gets built twice: once now, and
  again when the move lands — or the move has to carry it, which doubles the diff to
  review.
- The structure sets the price of every later port. With one `GameContext`, a fix calls
  across systems through `ctx.systems` instead of adding a hook and a round of `?? 0`
  guesses.

The order, then:

1. **D and E.** New structural debt goes into D or E and jumps the queue.
2. **C — Known divergences from CSBWin.** Frozen while D and E have items: a divergence
   found along the way is recorded here and not fixed, unless it blocks the D/E item at
   hand or corrupts saves. Taken in the index's order, unless the author pulls another
   forward.
3. **G — Unported CSBWin features.** Last. A missing feature is started only once D and E
   are empty, even when a dungeon, a save or a playtest needs it — note the need under the
   item instead. The author can always ask for one out of order.
4. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**H** is not debt: deliberate divergences, recorded so nobody "fixes" them.

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
| F3 | Phase 15 steps 3–5 | — | in `PLAN.md` |
| G1 | DSA gaps, and the footprint decoration | — | ⏳ |
| G2 | Ten DSA filters | — | ⏳ |
| G3 | The wings | — | ⏳ |
| G4 | CSB extensions, malformed heroes, the monster design options | — | ⏳ |
| G6 | UI effects | — | ⏳ |
| G7 | Save-format gaps | — | in `PLAN.md` |
| G10 | `StealFromCharacter`: the giggler steals nothing | — | ⏳ |
| G11 | `MakeMoreRoomInDB`: a full database refuses the record | — | ⏳ |
| G12 | `SmartDiscard`: a filling database is not thinned | — | ⏳ |
| G14 | `AsciiDump`: the resumed game's "ASCII DUMP" | — | ⏳ |
| H | Deliberate divergences | — | 🚫 |

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C79 · D10 · E7 · F12 · G15. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## D — State representation

Empty. New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

Empty. New architecture debt goes here, and jumps the queue.

---

## C — Known divergences from CSBWin

Taken in the index's order (see "Priority"), now that tiers D and E are empty.

Empty. A divergence found along the way goes here, with the next free ID.

---

## F — Verification debt

### F3 — Phase 15 steps 3–5 stay in `PLAN.md`

The render probe, the table-extraction round-trip checks and the comparison against CSBWin
screenshots are a live phase, so they stay in `PLAN.md` → "Phase 15" rather than being
copied here. The never-executed validation steps of phases 2, 4, 5 and 7 are all folded
into it.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. They come last (see "Priority").

### G1 ⏳ DSA gaps, and the footprint decoration

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
- **The footprint decoration.** `SummarizeRoomInfo`'s footprint arm
  (`Codea59a.cpp:401-424`) sets `decorations[2] |= 0x8000` when `SearchFootprints`
  (`CSBCode.cpp:7066`) finds a footprint between `d.IndexOfFirstMagicFootprint` and
  `d.IndexOfLastMagicFootprint` on the cell, or when the cell has the `ECF_FOOTPRINTS`
  extended cell flag. It is omitted at `src/renderer/csbwin/SummarizeRoomInfo.ts:515`. The
  DSA decoration gating (actuator type 47) is ported.

### G2 ⏳ Ten DSA filters

No dungeon we load defines any of them, so none could be verified if written. Each place
uses CSBWin's defaults.

- `ESL_CHARDEATHFILTER` (actuator type 47, `Character.cpp:2535-2589`).
- `ESL_FEEDINGFILTER` (`Character.cpp:4288-4344`). Its insertion point is marked in
  `src/renderer/ui/Feeding.ts:112`.
- `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`). It fires
  only on a `DisableMessage`, which the shipped dungeon never carries
  (`HallOfChampions.ts:342`).
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
  `:8336-8346`). See `MovementSystem.chargeStamina`'s comment (`MovementSystem.ts:249`).
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

`Party.findChampionByFingerprint` is where both would grow their second half. This is a
feature to build, not a branch to port: nothing in the port ever removes a living champion
from the party.

### G4 ⏳ CSB extensions, malformed heroes, the monster design options

- `pcA3->talents`, which `Champion` has no field for;
- the `legalHero` fallback (`Character.cpp:475`), which clamps an out-of-range hero text
  and retries it against "BOGUS / ILLEGAL HERO", where `HeroExtractor` rejects it
  outright;
- external portraits for `charID > 23`.

No shipped DM hero touches any of these.

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

### G6 ⏳ UI effects

- **Rune click flash** in the magic panel.
- **Interaction highlights**: button press and selection effects (flash, shading, invert)
  across UI regions, consistent with the hit-test rectangles.
- **`FlashButton`** on a movement arrow that was clicked or keyed. `MoveParty` returns the
  button and `HandleMouseEvents` flashes it (`doc/CSBwin-src/Mouse.cpp:1560-1567`).
- **The viewport flash on a blow**, and a light-level trace hook. `atk_LIGHT` itself works;
  this item is the flash, not the LIGHT attack.

### G7 — Save-format gaps stay in `PLAN.md`

Writing a CSBWin-compatible save is live work, so it stays in `PLAN.md` → "Phase 10"
rather than being copied here.

### G10 ⏳ `StealFromCharacter`: the giggler steals nothing

A monster attack with `monsterShouldSteal` calls `StealFromCharacter`
(`doc/CSBwin-src/Monster.cpp:239`). The port spends the blow and takes nothing
(`MonsterAttack.ts:195-197`). Port it there, through `ctx.systems`, with a tool that has a
giggler rob a champion.

### G11 ⏳ `MakeMoreRoomInDB`: a full database refuses the record

`DungeonState.findEmptyDBEntry` (`src/engine/DungeonState.ts:528`) returns `null` once a
database holds 1024 records (`:535`). At that point CSBWin calls `MakeMoreRoomInDB`
(`doc/CSBwin-src/Character.cpp:182`) to make room. This cannot happen in the shipped
dungeons.

### G12 ⏳ `SmartDiscard`: a filling database is not thinned

CSBWin's main loop calls `SmartDiscard(false)` on every tick
(`doc/CSBwin-src/CSBCode.cpp:678`), and the game start (`:10636`) and the tail of a save
(`SaveGame.cpp:1245`) call `SmartDiscard(true)`, which starts it over on a new database
(`SmartDiscard.cpp:747-757`). Each call does one step of a cycle through the misc, weapon
and clothing databases (`:764-793`): count the records in use, fifty a step, and once the
count reaches three quarters of the database's maximum (`:805-821`), scan the dungeon for
objects and discard them in priority order. None of it is ported. `Game.saveWritten`, the
save's tail, leaves out its `SmartDiscard(true)`.

### G14 ⏳ `AsciiDump`: the resumed game's "ASCII DUMP"

`AsciiDump` (`doc/CSBwin-src/AsciiDump.cpp:2137`) writes the whole dungeon as text to
`ASCIIDUMP.TXT`, starting with the game's and the levels' information, every cell, the
objects, and the monsters (`:2152-2160`). The one route to it is the second button of the
"GAME LOADED, READY TO PLAY." menu (`CSBCode.cpp:10497-10515`), which in the port only puts
the menu up again (`tag021028`, `src/renderer/intro/BootSequence.ts`). In a page it would be
a download.

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
  comment gives the reason. While a script holds the loop (`Game.isRunningScript`) the
  panel keys do nothing, as CSBWin's would wait in the queue for a pass that never comes
  before the credits; the two screens open only from a pass, so neither is up then.
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
