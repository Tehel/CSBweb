# dmweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- ⏸️ postponed until the default dungeon is validated (`DEBT.md` → "Priority")
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

This file carries only the phases that still have work in them, and describes them as
they stand (`CLAUDE.md` → "Write down the present, not the past"). When a phase is
finished, lift anything still open into **`DEBT.md`**, which is the authority on debt, and
any verified fact into `doc/`; then delete the phase's body and add its line to
"Completed phases".

## Current priority: a working game on the default dungeon

The goal is a complete, faithful game on `dm-atari`. The work, in order:

1. **`DEBT.md`'s active rows**: the unported CSBWin features the default dungeon and
   Chaos Strikes Back reach. `DEBT.md` says how
   to work an item. **One item per commit, a few per session**, then `/clear`. Its index is
   the live status; its first row is the next item.
2. **Rework the save menu** (Phase 10, step 11). The author sets its scope when it starts.
3. Phase 15 step 4 interleaves anywhere.

⏸️ **Postponed until the default dungeon is validated**: DSA extensibility and CSBWin's
custom-dungeon extensions (`DEBT.md` G1-G4), its debugging features (G14, the ASCII dump),
and Phase 15 step 5. The retail dungeon uses none of them. Features of **Chaos Strikes
Back** are not postponed: it is the next dungeon to try.

## Ground rules

1. **The build must stay clean.** `npm run build` runs `tsc && vite build`; `tsc --noEmit`
   must pass with zero errors before any commit. Note that `vite build` alone will happily
   succeed on broken code — esbuild strips types without checking them — so `tsc` is the
   only real gate. (The project sat with a broken `tsc` and a genuine runtime bug hidden
   among the type errors; don't let that recur.)
2. **No guessed tables in the shipping path.** If a rectangle/offset/formula is not extracted
   from the game data or transcribed from CSBWin, mark it as temporary.
3. **One renderer is authoritative**: the bytecode-based path.
4. Prefer small tooling over manual reasoning: table dumps, render probes, trace hooks.

## Status

**Working:**
- Data loading: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, save games (base and
  extended).
- The bytecode viewport renderer, the authoritative path. Every `0x22e` rectangle table is
  extracted at runtime; no guessed geometry remains in the renderer.
- Movement and collision: stamina per step, the move delay in ticks, CSBWin's one mouse
  queue for keys and clicks, and timers processed straight after a move.
- The timer queue, with CSBWin's duplicate-timer rules.
- Actuators, DSA scripting, teleporters, pits, doors, false walls.
- Missiles, throwing and clouds.
- Skills and experience (mastery, `AdjustSkills`, `LevelUp`), magic casting (all three
  spell classes), worn-object bonuses.
- Light levels and palette switching, sound, the message area (`SCROLLING_TEXT`), most of
  the DM UI.
- Monsters (`Monster.cpp`): groups hunt, flee, throw missiles, hit the party, take damage
  and die. The champions' own attacks (`Attack.cpp`), through the Party Attack Filter.
- The champion lifecycle: the Hall of Champions mirrors, the Reincarnate screen, feeding,
  poison, pit falls, death and bones, the Altar of Vi; sleep.
- The pre-game sequence: the title animation, the dungeon entrance, the door animation and
  the credits scroll. The game's `dungeon.dat` is read after ENTER, as CSBWin reads it.
- Three data sets (`src/data/DataSets.ts`: `dm-atari`, the default, `dm-windows` and
  `csb`), one chosen before the boot by `?dungeon=<id>`, and the DM Rules toggle.
- Debug scaffolding is confined to `src/dev.ts`, reached only through
  `isDebugFeaturesEnabled()`.

**Incomplete:**
- ⚠️ **The save menu.** Save files are done: the reader, and the game's own save button,
  which writes all sixteen blocks as CSBWin fills them. `tools/dump-live-save-file.ts`
  writes a file from a game played out of `dungeon.dat` and one from a game played on from
  a genuine save, and loads both back with the world, the party, a thrown object in flight
  and the object on the cursor intact. The menu behind the disk icon is to be reworked
  (Phase 10, step 11).
- ⚠️ **Validation.** Several completed phases listed validation steps (render tests, render
  probes, pixel comparisons against CSBWin screenshots) that were never carried out.
  Phase 15 gathers them.
- Everything in `DEBT.md`: the technical debt, the known divergences from CSBWin, and the
  unported CSBWin features (tier G).

**The evidence.** `npm test` runs `tsc` and every tool listed in `tools/run-checks.mjs`;
`npm test -- --frames` adds the golden frames. There is still no test *framework*:

1. **Golden frames.** `tools/probe-frames.mjs` and `tools/check-frames.sh` drive the real
   app over the DevTools Protocol and compare the screen states in `tools/frames/`. The
   probe reads the 320x200 canvas back and `tools/compare-frames.mjs` compares pixels, so
   nothing depends on the host machine. It also fails a baseline that holds two identical
   frames, so a frame that can no longer fail is caught.
2. **Verification tools.** `tools/run-checks.mjs` is the one list of them; don't copy it
   anywhere. They load the real game files, drive the real engine with a fixed RNG seed,
   print a human-readable table and assert invariants through `tools/lib/check.ts`, whose
   `finish()` also fails a run that made no checks. They are the regression suite for
   everything the frames cannot see. The pattern is in `.claude/skills/verification-tools/`;
   what Phase 15 still owes is shared fixtures.

## Completed phases

Open items from them are in `DEBT.md`. `doc/PLAN_ARCHIVE.md` (frozen) holds the working
notes of the phases closed up to 2026-09-26; for a phase closed later, its line here and
`git log` are the record.

| Phase | Subject |
| --- | --- |
| 0 | Consolidate rendering entrypoint |
| 1 | Load CSBWin viewport tables from `graphics.dat` |
| 2 | Faithful low-level blitter (pixel-index buffer) |
| 3 | Floor/ceiling pipeline |
| 4 | `SummarizeRoomInfo()` authoritative |
| 5 | Opcode surface area |
| 6 | Custom skins / `BACKGROUND_LIB` (🚫 skipped) |
| 7 | UI rendering (faithful DM layout) |
| 7.5 | Light level / palette switching |
| 8 | CSBWin-compatible actuators |
| 8.5 | Teleporter cell actions parity |
| 9 | CSBWin-compatible missiles |
| 9.5 | Skills & experience parity |
| 9.75 | Magic casting parity |
| 11 | Unify the messaging system |
| 12 | Monsters: AI, movement, combat |
| 13 | Champion lifecycle |
| 14 | Structural cleanup |
| 16 | Title screen and dungeon entrance |

## Next Steps (Phased)

Only the phases with work left in them.

### Phase 10 — CSBWin-Compatible Save/Load

Goal: read and write a save file CSBWin itself can load. **Reading and writing are done**;
what is left is the rework of the save menu (step 11). What the file cannot carry for a
dungeon with DSAs or an enciphered file is postponed with them (`DEBT.md` G1, G4).

#### The rework: what is already decided

The author sets the rest of its scope when it starts.

- **A save is a CSBWin `.dat` file, and the JSON wrapper goes.** A `.dmweb.json`
  (`src/engine/SaveGamePayload.ts`) pairs `runtime`, the port's own state in the shape of
  the build that wrote it, with `raw`, the whole CSBWin file the port writes. Only `raw`'s
  format is stable: `runtime` is refused at any other version, and `applySaveBytes` then
  loads `raw` as a genuine save. Saving the `.dat` alone ends the version bumps that
  strand saves. First, whatever only `runtime` carries has to be found a place in the
  file, or shown to follow from it: `src/data/CsbwinSaveGame.ts` → "What is not
  restored" is where to start, and `tools/dump-save-roundtrip.ts` is how to prove the file
  alone gives the game back. Both stores already list a genuine `.dat` from its own blocks
  (`src/data/saves/`).

#### What is left, in one place

`saveSaveGameState` (`src/data/SaveGameLoader.ts`) emits all sixteen blocks, and
`buildSavePayload` now hands it the three it used to leave out — the Extended Features
header, the object indirect index and the dungeon image — so **the game's own save button
writes a whole file**. Against the sixteen-block write order in
`doc/CSBWIN_SAVEGAME_REFERENCE.md`:

| Block | What it holds | State |
| --- | --- | --- |
| 0 | Extended Features, `dataTypeMap`/`dataIndexMap`, DSA blocks | ✅ written and byte-identical to all fourteen saves — header, both maps, the game info and the DSA level index with its 0xff terminator. `buildObjectIndirectIndex` builds the maps for a world this port holds, which is what blocks 10-13 will encode their RNs through |
| 1 | GAMEBLOCK1 | ✅ every field, from `GameState.block1`: `RandomGameID` drawn for a new game, `totalMoveCount` counted at `HandleMouseEvents`' record point, `Word22592`-`Word22598`, `Byte22808`, `SaveOption` 1. Byte-identical to all fourteen saves outside the bytes `SaveGame` never assigns |
| 2 | GAMEBLOCK2 (128 b) | ✅ all 21 fields, byte-identical to all fourteen saves. `partyMoveDisableTimer` (40), `Word11712` (42) and `Word11714` (44) are `PartyState`'s since DEBT.md C13. `ObjectInHand` (8) is an indirect slot now, encoded through the same index as the image; an empty hand is written as `RNnul` since DEBT.md C29 |
| 3 | ITEM16 | ✅ |
| 4 | characters + party tail | ✅ byte-identical to all fourteen committed saves, the thirty possession slots included — they go out through `encodeRN` as slot numbers |
| 5 | timers | ✅ the whole 16-byte `TIMER`, in all three sizes, byte-identical bar `unused13` in a freed slot |
| 6 | timer queue | ✅ byte-identical over the live `NumTimer` entries; the debris past them is not reproduced |
| 7 | image header (`DUNGEONDATINDEX`, 44 b) | ✅ built and byte-identical to `dungeon.dat` **and** all fourteen saves |
| 8 | level descriptors (16 b x `NumLevel`) | ✅ same |
| 9 | column index (`objectListIndex`) | ✅ same |
| 10 | object list (`d.objectList`) | ✅ built. Nothing but RNs, so it **cannot** be byte-identical — our slot numbering is our own — and it is checked by resolving instead; see below |
| 11 | indirect text index | ✅ built and byte-identical. Little-endian longwords, alone with the Extended Features header in a big-endian file |
| 12 | `sizeOfCompressedText` + the text | ✅ built and byte-identical. Little-endian size word, big-endian text |
| 13 | the sixteen databases | ✅ built. Every byte that is **not** an RN is the file's own, on `dungeon.dat` and all fourteen saves; the RNs are resolved and compared. This is 18-22 KB of the ~40 KB image |
| 14 | cell flags (`cellFlagArray`) | ✅ built and byte-identical, and `cellFlagArraySize` computes the 12366 both `dungeon.dat` and every save declare |
| 15 | final checksum word | ✅ `buildImageChecksum`, and proved against each save's **own** closing word |

**A whole file now round-trips.** `tools/dump-save-file-roundtrip.ts` takes each of the
fourteen committed saves, parses it completely, re-serialises **all sixteen blocks**
through `saveSaveGameState` — dungeon image and closing checksum included — and hands the
result back to this port's own reader. 605 checks: the header, the object list, the column
index, every cell flag of all fourteen levels, every record of every database field for
field, the indirect text, the compressed text, EXPOOL byte for byte, the party, all 120
possession slots, `ObjectInHand` and the flying-sword timer. It is what covers the words
the block-by-block comparisons have to hold out.

Three things had to change for it, all of them real:

- `buildObjectIndirectIndex` takes `heldReferences`. An object a champion carries is in no
  cell chain, so without a pass over the possession slots (and the object-carrying timers,
  and `ObjectInHand`) its slot keeps position 0 and the reference comes back naming the
  right record in the wrong corner of its cell. CSBWin does exactly these four passes, in
  this order (`doc/PROVEN_FACTS.md` → "Everything CSBWin converts to slot numbers").
- `buildCsbwinCharacterBlock` takes `encodeRN`, so the thirty slots go out as slot
  numbers. That closes the reservation block 4 has carried since it was written.
- The **object-carrying timers** have to be translated by hand. `parseTimers` leaves a
  timer's object RN as the raw word — nothing in this port consumes one — which is
  harmless while a file is only read and wrong the moment it is rewritten with a new
  numbering. `csbgame-flying-sword.dat` exercises it.

The work is serialization, not modelling: `src/engine/DungeonSnapshot.ts` already captures
everything blocks 7-14 carry, the image layout is solved and proven by parsing (see the
resolved blocker at the end of this phase), and `FirstAvailTimer` — block 2 offset 26 —
became available when `TimerQueue` gained CSBWin's free cursor.

**Two sections cannot be byte-identical, and that is not a defect.** Every word of block
10 and the link word of every record in block 13 is an RN, which in a save is a slot
number in the object indirect index — and `buildObjectIndirectIndex` numbers those slots
its own way, because CSBWin's order cannot be reproduced and nothing outside the file
refers to a slot number. Those words are checked by resolving instead: the maps are
written, read back through `readObjectIndirectIndex` (both `FormChecksum`s verified), and
each word resolved through them must name the object the reader got out of CSBWin's word.
That argument is weaker in kind than the byte comparisons around it — it would survive a
bug our encode and our resolve shared — and `tools/dump-dungeon-image-blocks.ts` says so
where it makes it. `dungeon.dat`, which stores packed RNs and needs no index at all, is
the compensating case: for it those same words *are* byte-compared, all 1682 of them.
<sub>`doc/PROVEN_FACTS.md` → "An RN in block 10 or block 13 cannot be byte-identical".</sub>

**Mostly, but not entirely.** Writing blocks 7, 8 and 14 found three fields the *reader*
was dropping, and a section cannot be written back from a model that does not hold it:
`LEVELDESC.FILL2[4]`, the low byte of `DUNGEONDATINDEX::word4` — both zero everywhere, but
neither guessable — and bits 8-11 of `LEVELDESC.word12`, which CSBWin declares no accessor
for and which are **not** zero: the fourteen DM levels carry 0, 1, 3 and 4 between them.
All three are now on `DungeonHeader` / `MapDescriptor`, named as CSBWin names them and
documented as unread.

Block 13 had the same disease and more of it. Ten further bit ranges across seven record
types were being read past — the door's `word2` bits 9-15, the teleporter's low `word4`
byte, the text record's `word2` bits 1-2, the creature's `word14` bits 4, 7 and 15, the
clothing item's `word2` bits 14-15, both scroll forms' leftover bits, the chest's whole
`m_word4` and its two trailing bytes, and the misc item's `cursed` and `subType` — plus
the whole of **`EXPOOL`**, database 11, which had no parser at all and is now carried as
raw bytes on `DungeonData.expool`. Four of the ten are not zero in the data, so four of
them fail a canary; the rest are carried for the reason `FILL2` is.
<sub>`doc/PROVEN_FACTS.md` → "Ten more fields the record parsers were dropping".</sub>

**The evidence gap is closed for everything the writer builds.**
`tools/dump-dungeon-image-blocks.ts` does it for the whole image — 687 checks over
`dungeon.dat` and all fourteen saves — and `tools/dump-save-blocks-vs-file.ts` parses each
of the fourteen committed saves, writes
blocks 2-6 again from what came out, and compares them with the file's own bytes — the
argument `tools/dump-character-block.ts` makes for block 4, widened to every block. All
five are identical in all fourteen. Writing it found two defects in blocks that were
marked complete: block 5 wrote zeros into `TIMER.unused13` where a real file holds 0xcd,
and nothing had ever looked at block 6's tail. Two regions are reported rather than
asserted, each for a sourced reason — `unused13` in a freed slot and the timer queue past
`NumTimer`, both CSBWin allocation debris (`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is
0xcd in a slot that has been used"), and block 1's bytes that `SaveGame` never assigns,
0xba in two of the saves (`doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what `SaveGame` writes
there, and which two fields are little-endian").

**Deferred on purpose, and none of it blocking:** the DSA global variables are not read from
`EXPOOL`; `d.Word11694` (`gameWon`) and `d.PartySleeping` are not restored; a record index
above 1023 cannot be expressed. All three are detailed under step 12.

**Deferred by the block-2 work (September 13th):**

- ✅ **Resolved: `partyMoveDisableTimer`, `Word11712` and `Word11714`** (`GAMEBLOCK2`
  offsets 40, 42, 44) are `PartyState` fields since `DEBT.md` C13 modelled the move delay
  and the throw's move lock; both the writer and the loader carry them
  (`tools/dump-live-save-file.ts` round-trips them).
- ✅ **Resolved: `ObjectInHand`** (offset 8) goes out as an indirect slot number, through
  the index `buildSavePayload` builds for the image — the same one block 4's thirty
  possession slots use, which was always the same dependency rather than two.
- ⏸️ **DSA programs are not re-serialized** (`DEBT.md` G1).
- ⏸️ **`SimpleEncryption` is neither written nor readable past the header** (`DEBT.md` G4).
- ✅ **The live path writes a whole file** (September 14th). `buildSavePayload` builds the
  object indirect index, the dungeon image, the Extended Features header and the character
  block together — they are one numbering — and `saveSaveGameState` closes the file with
  block 15. `GAMEBLOCK2.ObjectInHand` and the thirty possession slots go out as slot
  numbers, which retires the two reservations blocks 2 and 4 carried. The header is
  `buildLiveExtendedFeatures` (`src/data/CsbwinExtendedFeatures.ts`), field for field
  against `SaveGame` and with every zero measured rather than assumed
  (`doc/PROVEN_FACTS.md` → "The Extended Features header a live game writes").
  `sequencedTimers`/`extendedTimers` are true, so block 5 is the 16-byte `TIMER` the
  header declares.

  Evidence: `tools/dump-live-save-file.ts` (187 checks). A game played out of
  `dungeon.dat` — champions recruited at two mirrors, the party walked, an object thrown
  and still in flight, a second on the cursor — and a game played on from
  `csbgame7.dat`, each written and loaded back into a fresh engine. Six of its seven
  canaries fail when the field they blank is withheld; the seventh is named in the tool
  with the reason it cannot.

- ✅ **An original dungeon is converted on load, as CSBWin does** (September 14th).
  `src/data/CsbwinDungeonConversions.ts` ports `ConvertToIndirectText`,
  `MakeBigActuators` and `convertScrolls`, each behind CSBWin's own gate — the shape
  flags, which are false only for a `dungeon.dat`. So the in-memory world is always
  save-shaped and the writer never has to ask where it came from.
  `TextRecord.textIndex` is gone: `textOffset` is `DB2::index()` and means a word offset
  before the conversion and an index entry after, exactly as CSBWin's one field does.
  That closed a live bug — a genuine save arrives already converted, so `textIndex` was
  never set for one and every wall text, scroll and message was decoded from the wrong
  place in the compressed array.

  Evidence: `tools/dump-dungeon-conversions.ts` (143 checks). Every committed save was
  made by CSBWin from this same `dungeon.dat`, so its converted form is the oracle: 0
  differences in the 125-entry index, all 1749 words of compressed text, every TEXT
  record's rewritten index word, every scroll's new RN and `open` bit, and every
  actuator's `word8`. `DungeonImageOptions.noConvert` exists for exactly one caller,
  `tools/dump-dungeon-image-blocks.ts`, which has to hold `dungeon.dat`'s own shape up
  against the file.

- ✅ **A quick-save carries the converted image** (September 14th).
  `src/engine/DungeonSnapshot.ts` captures `textWords`, `indirectTextIndex`,
  `compressedText` and `expool`; `RUNTIME_SAVE_VERSION` went to 7 for it (it is 10 since
  `DEBT.md` D2b) and an older payload is refused rather than half-restored. `expool` is the one of the four that can be
  canaried — `dungeon.dat` has none and every save carries blocks of it — and the three
  text fields cannot, because this port's conversion of `dungeon.dat` reproduces the
  saves' arrays exactly; `tools/dump-save-roundtrip.ts` says so where it makes the claim.

- ✅ **A timer's object survives the file** (September 14th), which writing the live path
  is what exposed. The live `TimerEntry` keeps a missile's RN on an `object` field with
  no byte at all and puts the launch square in bytes 6-7 — where `ConvertTimers` says
  the object lives — so a saved missile lost its object and its packed position word
  both. `Game.collapseTimerBytes` and `restoreTimerQueue` are the two halves of the
  collapse now, and `CsbwinSaveGame.resolveTimerObjects` turns a loaded timer's slot
  number back into an RN, which `parseTimers` deliberately does not.
  <sub>`doc/PROVEN_FACTS.md` → "A live timer keeps its object in three places".</sub>

**Deferred by the live-path work (September 14th):**

- **A converted scroll's `m_word4` bits 1-15 go out as zero.** `convertScrolls` writes
  bit 0 over two bytes nothing initialises, so a genuine save carries allocation debris
  there — 28 of DM's 35 scrolls in `csbgame4.dat`. Zero is the only honest value for a
  scroll this port converts; reported rather than asserted, like `TIMER.unused13`.
- ⏸️ **`buildSavePayload` refuses a dungeon with DSA programs** (`DEBT.md` G1).
- ⏸️ **`MakeBigActuators` reads the actuator type after the byte swap, CSBWin before it**
  (`DEBT.md` G4).
- **Scenario 2 of `dump-live-save-file.ts` holds the monster state to a fixed point**
  rather than to the played game, because a load is not a no-op — `reloadAfterSaveGame`
  re-creates every monster group's movement timers and re-rolls their walk offsets, as
  CSBWin's does. Everything the reload does not touch is still compared one round trip
  earlier.

#### The original pre-work checklist

Kept because the rescoring below is written against its numbering.

1. **Inventory all save file blocks (CSBWin `SaveGame.cpp`)**:
   - Block1 (512 bytes), Block2 (128 bytes), Item16, Characters, Timers, TimerQueue.
   - Extended features: DSA blocks, extended wall decorations, sequenced/extended timers.
2. **Define missing runtime state in TS**:
   - Global engine state: random seeds, time counters, movement counts, party level/position/facing, UI state flags, object-in-hand, etc.
   - Timer queue metadata and ordering state (not just Timer table contents).
3. **Mirror CSBWin database record layouts**:
   - All DB records (door/teleporter/text/actuator/creature/weapon/clothing/scroll/potion/container/misc/missile/cloud) with correct bitfields, padding, and word sizes.
   - Include any save‑only fields (Item16 runtime indices, missile/cloud records) not present in base dungeon.dat.
4. **Add full object list serialization**:
   - `objectList`, `columnIndex`, `levelIndex`, and per‑cell object chains must be written/read exactly as CSBWin.
   - Ensure object positions (RN pos bits) and link fields are preserved.
5. **Persist cell flags and dynamic room state**:
   - Door/pit/falsewall/teleporter flags in `cellFlags` must be saved (not inferred from dungeon.dat).
6. **Character/party blocks**:
   - Implement CSBWin character block layout (3328 bytes) with exact packing of inventory, stats, skills, spells, wounds, and flags.
7. **Text/indirect text indices**:
   - Ensure `textWords`, `indirectTextIndex`, and any converted text tables are serialized when required by CSBWin.
8. **Extended features**:
   - DSA level index tables and DSA state blocks (if `CSBgraphics.dat`/extended flags present).
   - Extended wall decorations and related flags in save file header.
9. **Checksum/scramble parity**:
   - Implement CSBWin block checksums and scramble/unscramble exactly (endianness + word ordering).
10. **Round‑trip validation tooling**:
   - Add a tool to load CSBWin save → re‑serialize → binary‑compare.
   - Add targeted checks for door/pit state, object chains, and timers after load.

11. **Load/save menu behind the disk icon** (author request, September 2026) — ✅ done,
   September 13th. The disk icon opens a menu drawn in the 320×200 buffer, listing saves
   from browser storage or from a directory on disk, each row showing its date, level and
   party, newest first; LOAD acts on the selection, SAVE always creates a new file rather
   than overwriting one of four slots.

   - `doc/CSBWIN_MENU_REFERENCE.md` is the new sourced account: the icon
     (`buttons17760[1]`, id 140), graphic 0 and its four layout patches, the text
     metrics, `_WaitForMenuSelect`'s modality and press animation, the four save slots,
     and a numbered list of the five places this port deliberately diverges.
   - `src/renderer/ui/Menu.ts` is a faithful `_DoMenu` / `_WaitForMenuSelect`, usable on
     its own for the title-only and one-button menus and for the future title screen
     (`I1 != 0`, button set 1, centred at screen (47,33)).
   - `src/renderer/ui/SaveMenu.ts` is the extension on top. The list panel is made by
     tiling graphic 0's own interior band down over the full-width button frame — the
     same self-blit idiom the 1/2/4-option layouts use — which leaves the bottom pair of
     frames for LOAD and SAVE, hit-tested and animated through CSBWin's own rectangles.
   - `src/data/saves/` holds the two backends behind one interface, and
     `src/engine/SaveGamePayload.ts` the payload both they and the quick-save now share.
     `dev.ts` no longer has a save implementation of its own.
   - **F5 and F9 act on the same saves** (September 13th, second pass). They used to own a
     single `localStorage` key, so "the most recent save" meant one thing to the menu and
     another to F9. F5 now writes one more save to the current source — falling back to
     the browser when the file source is chosen but not connected, since a quick-save key
     must never raise a folder picker over the game — and F9 loads the newest *loadable*
     save across every store that can be listed without prompting, skipping a genuine
     `.dat` rather than picking it and then refusing it. `src/data/saves/registry.ts`
     holds the two singletons and the current source; `pickLatestLoadable` is pure and
     asserted. Anything left under the old key is migrated into the browser store once.
   - Evidence: `tools/dump-save-menu.ts` (120 checks — the table offsets as a canary, the
     panel built for real and measured pixel by pixel, `SplitLongLine`, the row
     formatting, and both metadata paths against the genuine saves) plus a sixth golden
     frame, `tools/frames/06-savemenu.png`.

   **What the file half can and cannot do**, measured rather than assumed: listing a real
   directory needs `showDirectoryPicker`, which is Chromium-only and hands back a handle
   for a directory *the player picks in the OS dialog*. There is no path access, so
   `~/dm-saves` cannot be opened by name and cannot be created — `getDirectoryHandle(…,
   {create:true})` only makes directories inside an already-granted handle. The handle is
   structured-cloneable and is remembered in IndexedDB so the pick happens once; the
   *permission* is not remembered, and Chrome re-asks with one click per page load. Both
   calls need transient user activation, which is why a click while the menu is up is
   handled straight from the DOM event instead of through the game's mouse queue.

   **Deferred, deliberately:**
   - ✅ **Genuine CSBWin `.dat` files load** (step 12, September 13th). They were listed
     with a `*` and an inert LOAD while their object references were undecodable; the
     star and the note are gone.
   - **No `<input type=file>` / blob-download fallback** for Firefox and Safari. The menu
     says `NEEDS A CHROMIUM BROWSER` on the file source and stays usable on the browser
     source; a fallback that cannot list a directory would not fit this menu's shape.
   - **No delete.** `BrowserSaveStore.remove` exists and nothing calls it, so the browser
     store grows without bound. The list scrolls, so this is untidy rather than broken.
   - **The sixth frame captures an empty list**, since the boot script clears IndexedDB to
     keep the frame byte-stable. The row rendering is proven by `dump-save-menu.ts`
     instead, not by pixels.
   - **`SAVE AND QUIT`** has no equivalent: there is no credits screen to quit to.

12. **A genuine CSBWin save loads.** ✅ done, September 13th.
   `src/data/CsbwinDungeonImage.ts` (`loadCsbwinWorld`) parses the dungeon image into a
   real `DungeonData`, `src/data/CsbwinCharacters.ts` unpacks `CHARDESC[4]` and the
   128-byte party tail, and `src/data/CsbwinSaveGame.ts` (`applyCsbwinSave`) turns the
   two into the `RuntimeSaveState` the engine already restores from. The disk menu's
   `.dat` rows are no longer starred; `applySaveBytes` sniffs our JSON against a binary
   and dispatches, so LOAD and F9 both act on them.

   **What unblocked it: an RN in a save file is an indirect index, not a packed RN.**
   `class RN` holds one `ui16` and resolves it through two global arrays, `dataTypeMap`
   and `dataIndexMap` (`doc/CSBwin-src/CSBTypes.h:268-370`); `ConvertListOfObjects`
   rewrites every reference in an original dungeon into a slot number the first time it
   is read (`doc/CSBwin-src/SaveGame.cpp:1916-2018`), and the two maps travel in the
   save's Extended Features block. So the possession slots that "came out as category
   0/1 with indices far past those databases" were never packed RNs — and neither was
   anything else in the image. `src/data/CsbwinObjectIndex.ts` reads the maps, verifies
   both `FormChecksum`s, and translates.
   <sub>`doc/PROVEN_FACTS.md` → "An RN in a save file is an indirect index".</sub>

   Evidence, in three layers:
   - `tools/dump-csbwin-world.ts` walks **every object chain** in all twelve committed
     saves — 1783 to 1908 objects each, up to 31 deep, through chests and monster
     possessions — and finds no free record, no index past a database, no category
     without one and no cycle. An early save holds `dungeon.dat`'s 1911 objects less
     exactly what the chosen heroes carried out of their mirrors.
   - `tools/dump-csbwin-party.ts` asserts that all thirty possession slots of every
     champion name a **live** record in one of the six carryable databases. This is the
     check that used to be printed and not asserted.
   - `tools/dump-csbwin-load.ts` is new and is the one that matters: it stands a real
     `Game` up on `dungeon.dat`, restores each save into it, and then asks the *live
     engine* where the party is, who it is, what its own cell holds, and whether every
     cell flag in all fourteen maps is the save's. 746 checks. Confirmed on screen too
     — `csbgame7.dat` loads in the running app with its four champions, their hands and
     its own corridor.

   ✅ **The timer queue is restored** (September 13th, second pass, on two save files
   made to order). The whole 16-byte `TIMER` is read and written, in all three of the
   sizes the Extended Features flags select, and the queue that orders it comes back
   verbatim rather than being re-inserted — CSBWin never re-sorts on load, and
   re-inserting would run the duplicate-timer rules over timers that legitimately
   coexist. **The quick-save gained this too**: it wrote the same single `timerWord8`
   field, so a door caught mid-close was lost across F5/F9 as well. Save format v6.
   Evidence: `tools/dump-csbwin-timers.ts` restores `csbgame4-door-opening.dat` and
   `csbgame4-door-closing.dat` — identical fresh games whose door timers differ in one
   byte — into a real `Game`, turns the clock, and watches one door open and the other
   shut. <sub>`doc/PROVEN_FACTS.md` → "The `TIMER` record".</sub>

   ✅ **The portraits load too** (September 13th, third pass). `CHARDESC` carries the
   picture rather than an index — 464 bytes of four-bitplane 32x29 at offset 336
   (`doc/PROVEN_FACTS.md` → "`CHARDESC` carries the champion's portrait as pixels") —
   so a loaded party had nothing for the status box to draw and showed four empty
   boxes, while a quick-saved party, whose champions still carried this port's
   `portraitGraphic`, drew correctly. `readPortrait` unpacks the bitplanes into
   `Champion.portrait` and `getChampionPortrait` prefers them, keeping the index as the
   fallback for champions the engine creates (it holds no graphics to blit from).
   Evidence: `tools/dump-csbwin-load.ts` decodes all four champions of every committed
   save and each is a cell of basic graphic 26 pixel for pixel — a canary that fails on
   a wrong offset, plane order or byte swap — and `tools/dump-portraits.ts` draws the
   real status bar into a real screen buffer and reads the portrait rectangle back, on
   both paths.

   ⏳ **Still deferred, and none of it new debt:**
   - ⏸️ **The DSA global variables are not read from `EXPOOL`** (postponed with DSA
     extensibility, `DEBT.md` → "Priority"). CSBWin takes them from
     `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i`, sixteen `ui32` a record
     (`doc/CSBwin-src/SaveGame.cpp:1746-1763`); `locateExpoolRecord` finds a record but
     returns only its first word. No committed save needs it — the shipped DM dungeon
     defines no DSAs at all (`numDSA` is 0 in all twelve, and no special-location
     records) — so the running game's globals are kept rather than cleared.
   - **`d.Word11694` (`gameWon`) and `d.PartySleeping`** are not restored; neither is in
     `GAMEBLOCK2` where this reader looks.
   - **A record index above 1023 cannot be expressed.** `dataIndexMap` is 16 bits and
     this port's RN index field is 10. CSBWin allows 64000. The largest index in any
     committed save is 682; `CsbwinObjectIndex.resolve` throws rather than alias, so a
     third-party dungeon that needed it would say so.

Status: 🔄 **the reader and the writer are finished; the save menu rework (step 11) is what
is left.** The steps of the checklist above:

- Step 1 (inventory the blocks) — ✅ done. The full write order, every block's size and
  the EXPOOL side-writes are tabulated in `doc/CSBWIN_SAVEGAME_REFERENCE.md`.
- Steps 2-5 (runtime state, DB record layouts, object list, cell flags) — ✅ effectively
  done, though not yet *serialized*. `src/engine/DungeonSnapshot.ts` captures exactly
  what blocks 7-14 carry, and the column-index fix closed the last gap in step 4. What
  remains for these is packing, not modelling.
- Step 6 (character block) — ✅ **done, September 13th.** `CsbwinCharacters.ts` packs a
  whole `CHARDESC` as well as unpacking one — stats, skills, wounds, the thirty
  possessions, the portrait bitplanes — plus the 128-byte party tail, and
  `saveSaveGameState` writes the result into block 4 instead of 3328 zeros.
  `tools/dump-character-block.ts` packs the block again for each of the fourteen
  committed saves and compares it with the file's own bytes: **all fourteen are
  byte-identical**, which is the same argument `dump-csbwin-save.ts` makes for the
  reader — the bytes were written by CSBWin, so no bug symmetrical between our reader
  and our writer can satisfy it.

  Getting there needed six fields with no reader in this port, all now carried on
  `Champion` (`doc/PROVEN_FACTS.md` → "Packing `CHARDESC` back"): `charFlags` — which is
  where a champion's **gender** lives, and was being dropped entirely on load —
  `timerIndex`, `talents`, `causeOfDamage`, `monsterCausingDamage` and `load`.
  `AddCharacter` now sets `charFlags` from the hero's gender letter, as CSBWin does.

  It also found a live reader bug: `CHARDESC.incantation` is a C string, and this port
  read it as "the non-zero bytes", so the runes a cast leaves behind it came back as a
  spell in progress (`doc/PROVEN_FACTS.md` → "`CHARDESC.incantation` is a C string").

  **Still owed here:** the thirty possession slots are written as this port's packed
  object ids. A file wants indirect slot numbers, and the maps that define them travel
  with the dungeon image, which steps 3-5 have yet to write — so this is a dependency,
  not a defect, and the byte-identical proof above is made on champions read *without*
  an object index.

  <sub>A free result along the way: `CHARDESC.load` as CSBWin stored it matches what
  `CharacterStats.characterLoad` re-sums, for all 42 champions of the committed saves —
  asserted in `tools/dump-csbwin-load.ts`, and the only outside check the weight tables
  have.</sub>
- Step 9 (checksum/scramble parity) — ✅ proven for blocks 0-6 in both directions, and
  now against files this project did not write.
- Step 10 (round-trip validation) — ✅ `tools/dump-csbwin-save.ts` reads genuine saves;
  `tools/dump-save-blocks-vs-file.ts` and `tools/dump-dungeon-image-blocks.ts` re-serialize
  each and compare it with the file's own bytes, block by block.
- ✅ **Resolved: the dungeon image layout is solved.** (Kept here because the route to it
  is the lesson.) The blocker was never the text section alone — two database record
  sizes differ from `dungeon.dat` (ACTUATOR is 10 bytes with `bigActuators`, SCROLL is 6
  from extended-features version `'B'`), and the indirect-text block is little-endian
  with a header field, `NumWordsInTextArray`, that `ConvertToIndirectText` repurposes to
  mean "index entries". `tools/dump-csbwin-save.ts` now proves the whole layout by
  summing every section and landing on `EOF - 2`, for twelve genuine saves. Every
  database, the object list, the column index and the cell flags are read now (step 12);
  when this was written only MISSILE was.
  What found it: save files made to order — a fresh game diffed against `dungeon.dat`
  gave hard anchors for the cell flags and the door database, and the gap between them
  was the answer. <sub>`doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file".</sub>

- 🚫 **Superseded blocker (kept for the record): the text section of the dungeon image
  did not parse.** The indirect text index is little-endian unlike the rest of the image
  and none of the candidate lengths closed, so everything after it — all sixteen
  databases and the cell flags — was unreachable, and
  `parseMissileRecordsFromSaveData` / `parseSpecialLocationsFromSaveData` returned
  `null` on every genuine save. Solved by the entry above; kept because the shape of the
  mistake (assuming one section was wrong when three were) is the lesson.

Note this is a large piece of work and is *not* a prerequisite for playability;
quick-save/load via a runtime JSON snapshot already works.

**The runtime snapshot now carries the world** (`src/engine/DungeonSnapshot.ts`,
save format v2). It used to carry the party, the tick count, the `ITEM16` pool, the
timers and the missile records and nothing else, so a quick-load reset every dungeon
mutation — doors closed again, moved objects snapped back to their `dungeon.dat`
cells, fired actuators re-armed — while the party kept its inventory. A door opened
with a consumed key was then unopenable and the save was dead. v2 adds cell flags
(with `tiles` re-derived), the object list, every database's records, the DSA state
machine positions and global variables, the champion-bones map, `d.RandomNumber`,
`d.Word11694` and the footprint trail. v1 saves are refused by `quickLoad` rather
than half-restored, since the world state they would need was never written.
Verified by `tools/dump-savegame.ts`. This does not shorten Phase 10 — the binary
format is a separate job — but it removes the reason to rush it.

**The payload layer now has evidence of its own** (`tools/dump-save-roundtrip.ts`). Until
it was written nothing exercised `buildSavePayload` / `applySavePayload` — the JSON file
F5, F9 and both stores of the disk menu actually write — because `dump-savegame.ts` drives
the runtime snapshot directly and the `dump-csbwin-*` tools drive the CSBWin reader. The
tool starts from a genuine CSBWin save, which is the hard case: such a party carries 928
bytes of `CHARDESC.portrait` pixels where a party this engine created carries a single
`portraitGraphic` index. 106 checks — portraits, possessions, `charFlags`, incantations,
the world snapshot, ITEM16, missiles and the whole timer table round-trip; both
`csbgame4-door-*.dat` doors still open and shut after being restored *through the payload*;
and five save/load cycles on a level with live monsters leave the timer table the same size
with no holes, which is the leak above.

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   asserting tools, then the frames with `--frames`. ~14s, ~33s with frames.
   `tools/` is inside the type gate. Shared helpers in `tools/lib/check.ts`.
   <sub>How it went, and the two real bugs it surfaced: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` starts its own dev server
   and headless Chrome and takes `--update`. Fourteen frames: the first six load
   the app with `?intro=0`, and `07-entrance` / `08-credits` / `12-game-loaded` load it
   again without, which is the only standing evidence that the corridor behind the prison
   doors actually renders. The rest boot with `?intro=0` once more and stand the party on
   a fixed square (`FACE` in `tools/probe-frames.mjs`): a pressed crack switch
   (`doc/PROVEN_FACTS.md`, "Crack Switch (In) placement"), two door ornaments, and a
   mirror on each F2 edge wall, positions 7 and 9 of `DrawWallDecoration`. Still owed to
   make it a real test: comparing the palette-index buffer rather than the RGBA canvas it
   is converted to.
   <sub>Baseline re-capture story: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>

3. ✅ **Render probe.** `tools/dump-render-probe.ts` runs every cell program of
   `pStdDrawCode` on its own, headless, over hand-built room data, against the real
   `graphics.dat` and `dm-atari` level 0, in both mirror parities. It asserts that the
   port's table is null in exactly CSBWin's 46 `NOP` slots, that no program warns or
   writes a pixel outside the 16 colours, and that all 244 renders hash as
   `tools/reference/render-probe.tsv` records. A deliberate renderer change looks with
   `--png` (one contact sheet per parity in `tools/output/`) and rewrites the baseline
   with `--update`. Each slot is tried with one summary per room type (a closed door, a
   visible pit and teleporter, no decorations or objects), so wall and floor decorations,
   text, objects and the other door states are still seen only by the golden frames.
4. 🔄 **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately. Part-paid by Phase 16: `tools/dump-image-codec.ts`
   decodes every image in both data sets and asserts each one fills its own buffer exactly,
   which is what caught the codec bug's blast radius, and checks each opcode on a hand-built
   stream. The *table* extraction (`0x22e`..`0x232`) still has no round-trip check beyond the
   canaries individual tools assert.
5. ⏸️ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation). Postponed, perhaps for good: staging the same scene in CSBWin without
   cheats costs more than it would prove, and the golden frames and the render probe
   already catch any pixel that changes unintentionally.

Status: 🔄 in progress — steps 1, 2 and 3 done, 4 part-done; 5 postponed.
