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

## Priority: paying the debt, then open-sourcing

**The game is complete.** Every FTL dungeon loads and plays, and so do the fans' dungeons
the welcome page lists. Dungeon Master has been won, once with a single champion on
a tablet, and Theron's Quest played to its end. The site around them is
deployed: the welcome page (`src/ui/welcomePage.ts`), a player's own data sets, the
server (`doc/DEPLOYMENT.md`). The work now is this list, in the index's order, and after
it cleaning the repository up to publish it as open source. Tiers D and E hold what the
code needs to be a base others can read and build on. The page's redesign is in: the
interface in the canvas (U), and the welcome page with its HOW TO PLAY, its ABOUT
(`src/ui/about.ts`) and its credits.

**Conflux 3.5** (`tools/fixtures/gamefiles/conflux-3.5-b8/`) is the third dungeon, a data set
(`conflux-3.5`) whose first ticks play (`tools/checks/watch-conflux-start.ts`) and whose start is a
golden frame. What waits on the author for it is C150. Its `dungeon.dat` is enciphered, and reads whole
(`doc/PROVEN_FACTS.md` → "The "simple" encipherment is `RC4.cpp`'s own cipher"). Its
skins are drawn (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Skins in the data sets"). Every DSA operation CSBWin has is ported, not only Conflux's share
(`tools/checks/dsa-census.ts`), and a dungeon with DSAs saves (`tools/checks/dsa-save.ts`).

**A — the Amiga version**, at the author's request, has no open item: the `dm-amiga` set
plays Dungeon Master with the Amiga 2.2's re-recorded sounds, the monsters heard moving as
they approach, in stereo, and the Amiga's dungeon.

**First, at the author's request: G29 — recording a game and playing it back.** Its
prerequisite comes first: the game is meant to be a function of its start, its VBLs and
the changes its input boundary logs at them (`src/engine/InputBoundary.ts`), and F22
proves it. Its row heads the index.

**Then, at the author's request: P — players' own data sets.** A player adds a dungeon
from their own files to the welcome page, plays it, edits it, deletes it and publishes it,
and the moderators approve, hide, show and edit what is published; what is left is P11, to
design with the author. They are not CSBWin features but the page's, and come before
every other tier.

**Before the rest, at the author's request: U — the interface in the canvas.** The
page's settings, map and champion views become dialogs drawn in the game's own screen,
from the game's own art, so the public build has nothing beside the canvas. It is the
page redesign's first part, and comes before every other tier.

The order, then:

1. **R and W — what a player of the public site can meet today**, in what only the port
   has: the page, the save store, F5 and F9, the files a player drops, the server. Some
   lose a game, a save or the site, so they come first.
2. **D and E.** New structural debt still goes into D or E and jumps the queue.
3. **C — Known divergences from CSBWin.** A divergence found along the way goes here and is
   taken before the G items: a known bug outranks a missing feature.
4. **G — Unported CSBWin features a dungeon the port plays reaches**, in the index's order.
5. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**Postponed (⏸️).** These are not part of the work: they are not taken in order, and no
session picks one up unless the author names it:

- **A save of a dungeon the port does not know** (G22).
- **CSBWin's debugging features** that are not part of the game: the ASCII dump, and the
  DSA trace, whose flags `WriteDSAs` follows the DSAs with, an `EDBT_DSAtraces` record
  (`DSAIndex.WriteTracing()`, `doc/CSBwin-src/SaveGame.cpp:1014-1018`) that a read takes
  back (`DSAINDEX::ReadTracing`, `DSA.cpp:5554-5577`). The port writes none.
- **Comparing frames against CSBWin's own screenshots**: staging the same scene in
  CSBWin, without cheats, costs more than it proves, and the golden frames and the render
  probe already catch any pixel that changes unintentionally. When it is taken, the
  canvas's colours go with it: an Atari intensity times 36, not CSBWin's RGB555 (H).
- **Fullscreen filled by a fraction** (E22), until players ask for it: the author decides
  then, from the analysis the item records.
- **X — Extras**: gameplay features CSBWin does not have, which the author wants in time.

A CSBWin feature that a dungeon the port plays needs is *not* postponed, Chaos Strikes
Back's first: it stays in the active list, even if Dungeon Master never reaches it.

**H** is not debt: deliberate divergences, recorded so nobody "fixes" them.

**X** is not a divergence either: every extra sits behind a setting of its own that is off
by default, so with them off the game is CSBWin's and the golden frames do not move.

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
   byte-identical before and after (only `checks/save-menu`, by one byte, and
   `checks/savegame`, by its payload's size, vary on their own: both carry the save's
   wall-clock date; `checks/new-game` and `checks/game-events`, by the random game ids
   they print; and `checks/monster-design-options`, whose unseeded games draw their seed
   from `Math.random`, so it compares only with `Math.random` pinned, through
   `npx tsx --import`), and the author's runtime saves hash the same after load and
   after 600 ticks. A refactor that uncovers a divergence records it in tier C. If it is
   fixed at all, the fix goes in a **separate** commit, so every commit is either
   behaviour-neutral or a fix, never both.
4. **A fix owes the usual five things** (`.claude/skills/playtest-bug/`): the CSBWin
   citation, the fix, a `tools/checks/` tool that fails before it, a `doc/PROVEN_FACTS.md` entry
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
| F22 | `tools/checks/replay.ts`: a game logged at the boundary plays back the same | M | ⏳ |
| G29 | Recording a game and playing it back | L | ⏳ after F22 |
| F21 | 3D2D1D's walkthrough is not replayed through `Game` | M | ⏳ |
| C194 | A DSA's wall graphic counts as a real decoration, so it hides no text | S | ⏳ |
| C195 | Wall texts skip `TranslateWallLanguage`, which makes every code from 28 a space | S | ⏳ to decide with the author |
| P11 | A save keeps its own dungeon, so a set's new `dungeon.dat` does not reach it | ? | ⏳ to design with the author |
| E40 | The statistics page's heat map | M | ⏸️ |
| C150 | Conflux's "Jitter" DSA can pass an overlay jitter, where CSBWin's source stops | S | ⏸️ waits on the author |
| G21 | `Translation.txt`: the messages the executable prints, translated | — | ⏸️ |
| G22 | An unknown dungeon played from its save | — | ⏸️ |
| X9 | Thrown weapons' tags kept across a save | M | ⏸️ |
| X10 | The cells the party has seen, kept across a save for an automap | M | ⏸️ |
| X16 | The map's info follows a DSA's program to the squares it names | M | ⏸️ |
| X17 | The map's info names a Hall of Champions mirror's champion | S | ⏸️ |
| X18 | The scents compared with a square on every set: the Atari's bug fixed | S | ⏸️ waits on the author |
| E22 | Fullscreen filled by a fraction | M | ⏸️ waits on the author |
| H | Deliberate divergences | — | 🚫 |

The rows above E40 are the active list. A new row takes its tier's place above it. The F
rows are independent of the rest ("Priority", point 5), so they can be taken anywhere.
The ⏸️ rows are postponed (see "Priority") and are never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: A11 · C196 · D22 · E44 · F24 · G31 · P13 · R17 · U13 · W8 · X19. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## A — The Amiga version

At the author's request: a `dm-amiga` set, "Dungeon Master Amiga", that plays the Amiga
release's sounds where the Atari plays its own, adds the sounds the Atari never had, chief
among them a monster group heard moving, by position and in stereo, and plays the Amiga's
dungeon. Everything else is the port as it is, CSBWin's engine under DM's rules.

**The reference and the disk** are `doc/AMIGA_DISK_REFERENCE.md`'s. For what only the
Amiga does, the reference is ReDMCSB's branch for **A22E**, "Dungeon Master for Amiga 2.2
English", in `doc/ReDMCSB-src/` (`npm run fetch-redmcsb-src`); everything CSBWin does
still follows CSBWin (H). The 2.2 English disk's `dm`, `graphics.dat` and `Dungeon.dat` are
`tools/fixtures/gamefiles/amiga-2.2/` (`npm run fetch-gamefiles`). The doc lists how its
`graphics.dat` differs from `dm-atari`'s, and gives where `dm`'s tables are, which
`tools/lib/amigaDm.ts` reads and `tools/checks/amiga-disk.ts` proves against ReDMCSB's
source.

**The set** is `dm-amiga`, "Dungeon Master Amiga", in `tools/data-sets.json`: the Amiga's
`Dungeon.dat`, and a `graphics.dat` that a step of `fetch-gamefiles` builds,
`tools/checks/amiga-graphics.ts --write`, which proves it and plays a new game on it. It is
`dm-atari`'s with the Amiga's credits (5), picture 396, objects' names (556) and font (557)
in their place, then its 35 sounds and the port's table item, 598, appended
(`doc/AMIGA_DISK_REFERENCE.md` → "The `dm-amiga` set's `graphics.dat`"). The port reads the
table item into `GameTables.amigaSounds` (`src/data/tables/AmigaSoundTables.ts`), and
`SoundManager` plays the Amiga's 8-bit recordings at their Paula rates in the Atari's place
(`doc/AMIGA_DISK_REFERENCE.md` → "The sounds, played", `tools/checks/amiga-sounds.ts`),
and hears each as A22E does: at a volume on each channel by where it is, on two voices,
and with `deltaTime` 1 as one of two pending sounds (`doc/AMIGA_DISK_REFERENCE.md` → "The
sounds, heard", `tools/checks/amiga-sound-path.ts`).

**The sound table** is `G0060_as_Graphic562_Sounds[34]` (`doc/ReDMCSB-src/DATA.C:1165-1201`),
at `dm:data+3738`. Entries 0-21 are the Atari's ordinals; 22, 23, 24, 26, 27, 32 and 33 are
the movement sounds (`DEFS.H:87-98`), 25 the horn, 28 the war cry, 29-31 the attacks of
the rock, the water elemental and the couatl. The Amiga plays an entry at Paula period
`72800 / Period` (`SOUND.C:1107`), so 112 is 650, 5457 Hz on a PAL machine.

**The Amiga's own sounds**, ordinals 22-33, are played: a group's footsteps
(`F0514_MOVE_GetSound`), a couatl's flip, A22E's eleven attack sounds, and the war cry
and the horn, which `dm`'s own `F0407_MENUS_IsActionPerformed` plays
(`doc/AMIGA_DISK_REFERENCE.md` → "The Amiga's own sounds",
`tools/checks/watch-amiga-footsteps.ts`).

**Volume and stereo** are A22E's, and the port's for the set: `doc/AMIGA_DISK_REFERENCE.md`
→ "The sounds, heard".

**The dungeon** is the Amiga `Dungeon.dat` as it is: compressed, the Atari 1.2 image but
for actuator 565 on map 7 (level 8), and a checksum (`doc/PROVEN_FACTS.md` → "A PC
`dungeon.dat` is the Atari image, little-endian", which calls it the 2.0 disk's).

Decisions taken with the author:

- **2.2 English is the base**, not 3.6.
- **The set's `graphics.dat` is `dm-atari`'s, with the Amiga's 35 sound items and one
  table item appended, and `dm`'s palettes, ornament coordinates and creature replacement
  colours in items `0x22e` and `0x232`, at the Atari's 3 bits a channel.** Its sounds 533-555 stay the Atari's 4-bit ones, which CSBWin's
  `SNDexpand` reads, so the set stays a folder CSBWin plays; the port plays the appended
  ones. Re-encoding the Amiga's in 4 bits in their place would lose what they are for.
- **The entrance is DM Amiga 3.6's**, A36M's, not 2.2's: the doors 2 pixels every 40 ms,
  and the rattle every 0.8 s at its own `Period`, 79, 3851 Hz, as a longplay of the Amiga
  release shows. A22E plays it at the Atari's 145, every third of CSBWin's steps, which on
  the Amiga is faster, 7065.5 Hz, where on the Atari it is slower
  (`doc/AMIGA_DISK_REFERENCE.md` → "The sounds, played").
- **Whatever makes the set recognisable as the Amiga's comes with it.** The Amiga's
  credits (5), font (557), objects' names (556) and picture 396 replace the Atari's in
  place: they are in the formats CSBWin reads, so the folder still plays in CSBWin.

**A22E's own code is classed** (`doc/AMIGA_DISK_REFERENCE.md` → "A22E's own code,
classed"): the machine's alone, the Atari's tables moved into `dm`, the compiler's layout,
carried by the sound path, in the code or in the set's items `0x22e` and `0x232`, or left
as CSBWin does (H). No item of A is open.
The disk's bonus dungeon, `DungeonB.dat`, the Amiga's own Kids dungeon, is not taken (the
author).

The Amiga's FTL logo (`swoosh`, a program of its own) is not taken: it plays and looks as
the Atari's does (the author).

**Chaos Strikes Back for the Amiga is not part of A.** When a set of it is started, its
introduction, a long animation with sound that the Atari's CSB does not have (seen by the
author in a longplay, probably of the Amiga 3.6), needs a player of its own, as `Swoosh`
is for the Atari disk's logo. Nothing of it is read yet: not the disk (`fetch-gamefiles`
takes CSB's Atari archive only), not the files the introduction is in, nor their format,
nor a reference for its code.

---

## P — Players' own data sets

At the author's request, from the forum: a player adds a dungeon from their own files, plays
it like any other, and later offers it to the site. It mirrors CSBWin, which plays whatever
its `directory=` holds (`src/data/DataSets.ts`), so the engine does not change and nothing
goes in H. A set is kept in the player's browser, then published to the site, where the
moderators approve it.

What stands: a local set is a record of the store's `dataSets` object store
(`BrowserDataSetStore`, `src/data/saves/`), `LocalDataSetRecord` in
`src/data/LocalDataSets.ts`. A `?dungeon=local:<id>` plays it (`chooseDataSet`,
`src/main.ts`): its `DataSet` follows from its files (`localDataSet`), and the boot reads
them by name through `recordFiles`, its base set's folder giving a `graphics.dat` it does
not have, as a manifest set's are read through `folderFiles` (`src/data/DataSetFiles.ts`).
It sends no statistics. An imported save is held against its `dungeon.dat` as any set's
is, and one whose walls moved is stored on IMPORT ANYWAY (`checkDungeon`, `doc/SAVES.md`
→ "An import is checked against the dungeon"), so that a set being built keeps its saves
as its walls move. `tools/checks/local-data-set.ts` plays such
records against their manifest sets. The welcome page (`src/ui/welcomePage.ts`) shows the local sets beside the
manifest's, under the same order, a record's thumbnail as its tile's picture, and counts
their saves; its last tile, "+ Add my own", opens the form that adds a set
(`src/ui/addDataSetForm.ts`), a modal dialog on one screen. On its left, what the player
gives: the name, the id (made from the name until the player writes one), a description,
the authors, the reincarnation rule (DM's at first), DM's or CSB's graphics for a set without a
`graphics.dat`, and one area that takes the files, dropped or picked, each going where its
name says; a PC `dungeon.dat`, little-endian, is kept as the Atari file it is the twin of
(`src/data/LittleEndianDungeon.ts`, `doc/PROVEN_FACTS.md` → "A PC `dungeon.dat` is the
Atari image, little-endian"), so the record holds only what CSBWin reads. On its right, the checklist of the name, the id and the six files, crossed or
checked, a removable file on its row, and on the thumbnail's, while it has none, "Generate
from data", which draws the site's sets' thumbnail, the title's last frame
(`src/renderer/intro/TitleThumbnail.ts`, `tools/gen-thumbnails.ts`'s too), from the set's
`graphics.dat` or its base set's, and once it has one, the checkbox "As the title", which
the boot reads to show it, reduced to sixteen Atari colours, in the title animation's place
(`src/renderer/intro/TitlePicture.ts`); under it, what the dungeon holds once its
`dungeon.dat` reads (`dungeonCensus`, `src/engine/DungeonCensus.ts`, whose DSA half
`tools/checks/dsa-census.ts` checks); and CANCEL and CONFIRM. `checkLocalDataSet`
(`src/engine/LocalDataSetCheck.ts`) runs at every change with the boot's own readers, each file read, parsed and hashed once and `src/engine/FileSignatures.ts`'s rules, and
makes the record CONFIRM stores; the page then shows the set selected. A pen on a local
set's picture reopens the form on its record: its id fixed, since its saves are filed
under it, and its `dungeon.dat` replaceable but not removable; the record CONFIRM writes
keeps when it was added, and a new `dungeon.dat` gives it a new signature, which the
saves already stored do not need. The form's DELETE asks first, counting the saves that
go with the set and pointing to the save menu's EXPORT, then removes the record and
those saves in one transaction (`BrowserDataSetStore.remove`). Its PUBLISH, enabled while
the form shows the record as stored, sends it to the server (below), and the page then
asks `api/data-sets` again.
`tools/checks/local-data-set.ts` proves the check, the record and the census,
`tools/probe-frames.ts` drives the form, adding, editing, publishing and deleting a set.

The server lists the site's sets from its store (`server/dataSets.ts`, `doc/DEPLOYMENT.md`
→ "The game files and the manifest"): each row approved or pending, with its owner's
`playerId` or none for the site's, `api/data-sets` answering each player the sets they
may see. Its moderators are the `playerId`s `MODERATOR_PLAYER_IDS` lists: they are offered
every set, told so (`"moderator": true`, `DataSetManifest.moderator`), and the welcome page
lists them the hidden sets too (`chooserSets`). A tile's name says its set's state: cyan
local, red pending, purple hidden (the one colour of the page outside the UI palette),
white otherwise. Its `gamefiles/` is mounted read-write, and `server/backup.ts` copies the folders
of the sets beside the store's snapshots. It reads a set with the page's own
check: `npm run build` bundles `checkLocalDataSet` and its readers for Node into
`dist/server/LocalDataSetCheck.js` (`vite.config.mts`, `doc/DEPLOYMENT.md` → "The build"),
which `server.ts` loads at start-up and hands the API (`CheckDataSet`, `loadCheckDataSet`,
`server/app.ts`), a tool the source's function instead, and the publish route reads a set
with it (`server/publish.ts`).
`tools/checks/build.ts` proves the bundle says what the source says, `tools/checks/server.ts`
that the server does not start without it, and `tools/check-image.sh` that the image's
Node runs it. A published set's row keeps its dungeon's walls, read by the same module
(`fillWalls` at start-up for a row that keeps none), which `api/data-set-walls` answers,
so that an import in another set names it (`doc/SAVES.md` → "An import is checked against
the dungeon").

A published set is moderated from its tile (`src/ui/welcomePage.ts`): the tick and the
cross on a pending set, which approve and reject it, and the eye on any other, which hides
and shows it, to a moderator; the cross alone to the owner of a pending set, which
withdraws it. And the pen, first, on every published set, to a moderator, which opens the
form on the set as the site holds it, to edit its text and files: its CONFIRM sends the
edit as a form (`server/edit.ts`), and a change of files writes the set a new folder,
`<dir>@<n>`. Each is a `POST api/data-sets/<id>` (`server/moderate.ts`, `doc/DEPLOYMENT.md`
→ "Moderating the sets"), the page then asking for the sets anew. The dev server answers
it too, replaying the changes made since it started over the store it makes at each
request, and has one moderator, `DEV_MODERATOR_PLAYER_ID` (`vite.config.mts`), whom
`tools/check-image.sh` makes the image's too. `tools/checks/server.ts` asserts every action,
edit and refusal, and `tools/probe-frames.ts` moderates and edits the set it publishes,
from the tiles, as that moderator and as its owner.

A published set's files can be taken away: the book on its tile offers them as one zip,
`<name>.zip`, made in the page from the files the server serves (`src/data/DataSetArchive.ts`),
a folder CSBWin plays. Then it lists the set's documents, the manuals and solutions its
folder holds for its players, a link each; to a moderator, it adds a file chosen on the
drive and removes one
(`server/documents.ts`, `doc/DEPLOYMENT.md` → "A set's documents"). The store lists them in
`data_set_documents`, and each change writes the set a new folder, as an edit of its files
does. `tools/checks/server.ts` asserts each change and refusal, `tools/checks/data-set-archive.ts`
the archive of every set, and `tools/probe-frames.ts` downloads the archive, adds and
removes documents from the book, as the moderator, and reads them as the owner.

The `<id>` is a folder's name (`LOCAL_ID_PATTERN`: lowercase letters, digits, `.`, `-` and
`_`, at most 40), since publishing makes it the set's folder on the server. No shipped dungeon
names its `graphics.dat` or `CSBgraphics.dat`, nor expects a `CSBgraphics.dat`, so the
signature checks are proven on dungeons the tool builds.

Decisions taken with the author, for every row:

- **A local set's id is `local:<id>`**, the `<id>` chosen by the player and unique among
  their local sets. No manifest id has the prefix, so a local set never shadows a site set.
  Publishing drops the prefix and checks that the id is unique on the server.
- **No `graphics.dat` given: the player chooses DM's or CSB's.** The set then reads that
  set's file (`dm-atari` or `csb`) from its folder.
- **No statistics for a local set**: `GameEvents` sends nothing. The server's
  `events.ts` takes only manifest ids anyway.
- **The `playerId` is a secret** (`src/ui/gameEvents.ts`). Ownership on the server rests on
  it alone, so the server never returns one, writes one in its logs or takes one in a URL's
  query. A lost id is handled by hand on the forum for now.
- **Moderators, not one author**, so that the burden can be shared. A set with no owner
  (the manifest's, uploaded by hand) is the site's, not a moderator's.
- **PUBLISH leaves the local record as it is**: a cyan tile beside the published one, its
  saves still filed under `local:<id>`, and the player can go on building it. A new
  version is a new local set, under a new id. Deleting the record once its set is
  approved, its saves moved to `<id>`, may follow as an item of its own.
- **Moderation from the tiles, and nothing more**: deleting an approved set, taking an
  approval back, and the sets' order and default are left to a moderator's hands on the
  server (`doc/DEPLOYMENT.md` → "Moderating the sets"). Hiding answers a complaint without
  costing a player their saves.
- **A moderator edits any set, the site's too, from its pen**: its text, a thumbnail, a
  description, and rarely a `.dat`. A folder never changes once written, which the backup
  relies on, so a change of files is a new folder, `<dir>@<n>`, and the backup copies every
  set's folder. A new `dungeon.dat` reaches no save already made (P11), which the form says.
- **A published set is never captive**: the book downloads its files as a zip, built in
  the page from the files already served, so the server gains no endpoint and no work. A
  local set's files are the player's already.
- **Documents are files of the set's folder**, one row each of `data_set_documents`, so a
  document belongs to one set and the backup copies it with the folder. A moderator adds
  and removes them, on any published set; a local set has none, and the game reads none.

### P11 ⏳ A save keeps its own dungeon, so a set's new `dungeon.dat` does not reach it

To design with the author, and complex. A CSBWin save holds the whole dungeon (blocks
7-14), and a read installs it in place of the set's `dungeon.dat`. A local set's pen
can replace its `dungeon.dat` (P, "What stands"), and the saves already stored keep the
dungeon they were made in. So a player who changes their dungeon and loads an old save
plays the old dungeon, and sees none of their changes (`doc/SAVES.md` → "A save is its
own world"). The same happens to any import the dialog stores as a slightly different
dungeon, on IMPORT ANYWAY. CSBWin behaves the same way: a save
is the world. What the port should do is open: tell the player, refuse, or carry the
party into the new dungeon (as Chaos's "MAKE NEW ADVENTURE" carries a party into
`mini.dat`). A moderator's new `dungeon.dat` for a published set does the same to its
players' saves (`doc/DEPLOYMENT.md` → "Moderating the sets"), the form saying so.

---

## U — The interface in the canvas

The page holds nothing beside the canvas (`index.html`): what it offered moved into it,
as dialogs drawn in the game's 320x200 buffer like the save menu: the settings, the map,
the champion table. The data set is chosen on the welcome page (`src/ui/welcomePage.ts`), which opens `?dungeon=`. The
look is the save menu's, cut from graphic 0 and drawn in the UI palette's sixteen
colours, the design canvas's widget kit (`src/renderer/ui/Widgets.ts`). At 320x200 there is
one font size, so a setting is one line, and its description goes in a help line at the
dialog's foot. Being in the buffer, the dialogs are under the CRT effect and in
fullscreen, and the golden frames see them.

The settings dialog (`src/renderer/ui/SettingsDialog.ts`) is the first: Esc or a double
click on the message area opens it. Its GAME, DISPLAY and SOUND tabs set the player's
settings, and KEYS binds the keys (`src/renderer/ui/SettingsKeys.ts`). Its EXIT leaves
for the welcome page, and asks first in `_DoMenu`'s two-option menu, as what has not been
saved is lost. On GAME and DISPLAY each
setting is a button holding its name, two a line; the dialog has five lines
(`SETTING_LINES`), and GAME takes three.

The map dialog (`src/renderer/ui/MapDialog.ts`) is the second: with GAME's MAP VIEW on,
the MAP key, which no preset binds, or a long press on the message area opens it. It
draws a level whole, the party's first, its columns and rows numbered, `<` and `>`
for the others, and G, M or I marks the squares with a monster generator, monsters or an
item; beside it, a square's info (`src/engine/CellInfo.ts`): what it is, where
it leads, what lies on it, what its actuators need and act on, what acts on it, and where
the objects its locks need are, each square it names a link. A click on a square shows
it; a page opened with `?dev` moves the party by a press held on one. A DSA's program
names no link yet (X16).

The champion dialog (`src/renderer/ui/ChampionDialog.ts`) is the third: with GAME's
CHAMPION VIEW on, the CHAMPIONS key, which no preset binds, or a long press on a
champion's stat bars opens it, the long press marking that champion's column. Its two
tabs hold the levels, maxima and attributes, then the sixteen sub-skills, each level or
sub-skill its mastery and a bar of its progress. With CHAMPION VIEW on, a left press on
the bars, where it is the box's inventory button, is held back: released before the long
press's threshold, it is queued at the release, so the inventory opens late by as long
as the press lasted. ⚠️ **The gesture is a trial.** If the late click is felt in play,
the other ways in are a double click on the bars (every click there waiting out the
double-click interval), a CHAMPIONS button in the settings dialog, the message area's
long press shared with the map through a small chooser, or the press acting at once
(the inventory opened on the press and left under the dialog).

Fullscreen is DISPLAY's FULLSCREEN (`src/lib/fullscreen.ts`): `#game`, both canvases, at
the largest whole multiple of 320x200 that fits, in device pixels, centred on black. It is
the page's state, not a setting, as a browser enters fullscreen only at a gesture; a
finger's gesture is its lift, so a tap waits for it. Where the browser has the Keyboard
Lock API (Chromium's), Esc is locked in fullscreen and still opens the settings, and Esc
held down leaves; elsewhere Esc leaves, and the double click on the message area opens
them.

The page installs as an app (`src/assets/manifest.webmanifest`, linked and built by
`vite.config.mts`), with `display: fullscreen` and `orientation: landscape`: launched from
the home screen, it is fullscreen in landscape from its first frame, without a gesture,
Android's bars hidden too. `#game` fills the app's window (index.html), the screen sized
in it as in fullscreen, and there DISPLAY's FULLSCREEN is dim, as there is nothing to turn
over. A browser matches `display-mode: fullscreen` in an element's fullscreen as well, so
the installed game is that media query with no element in fullscreen. An installed app
keeps the `display` it was installed with until it is installed again. There is no
service worker: the game is not playable offline.

None of it changes the game: with every new setting at its default, every tool's output
and every golden frame stay the same, the dialogs aside. Each item owes its check: a
golden frame for what it draws, and a probe or a `tools/` assertion for what it does.

---

## R — Robustness

What a damaged or hostile file, a second tab, an error or the page's own controls can do to
a game: bugs in what only the port has (the page, the save store, F5 and F9), and in how it
takes untrusted data. A file the player drops on the page and a custom dungeon are
untrusted: they may stop the game with a message, as CSBWin dies, but never crash or hang
the tab, nor corrupt what is stored. Each item owes what a fix owes ("How to work this
list", point 4), its check included.

---

## W — The public server

`server/`, the page's host at `https://csbweb.looten.net/` (`doc/DEPLOYMENT.md`), is on the
open internet behind the host's nginx. Its weak point is availability: what an anonymous
client can make it hold, compute or keep. What holds already: paths (`..`, `%2e%2e`,
`%00`, dotfiles all refused), the body's size limit, events rebuilt from checked fields
only, the rate limits counting an IPv6 client by its /64, a budget of events a day, a
game's `started` and `won` stored once, a log of bounded rows, a champion's name of the game's characters, a POST from another site's page
refused, a content security policy and `nosniff` on every answer, errors that leak nothing, a
container held to a memory, process and privilege budget, read-only but for its data, and
statistics aggregated as the events arrive, each answer capped and cached 30 s. Each item ships with its check in `tools/checks/server.ts`
or `tools/checks/stats.ts`.

---

## D — State representation

New state-representation debt goes here, and jumps the queue.

---

## E — Architecture

New architecture debt goes here, and jumps the queue. Every E item is a refactor: the rules
of "How to work this list", point 3, apply, byte-identical tool output included. What the
page redesign adds is the exception: E40's heat map, and E22's fill.

The structure need no longer follow CSBWin's files (the author's decision): a module may
gather or split CSBWin's functions as the code's concerns ask. What still follows CSBWin is
the behaviour, the names of ported functions, which keep the two codebases greppable
against each other, and the file formats.

### E40 ⏳ The statistics page's heat map

The statistics page is built (`doc/STATISTICS.md` → "The page"), all but a level's heat
map, as designed with the author:

- **A click on a level's row** of the selected set's deaths per level draws the level from
  the set's `dungeon.dat` (`DungeonLoader`, rooms in `MapDialog.ts`'s `ROOM_COLORS` as CSS),
  each square shaded by its deaths (`api/stats/<id>/<level>`), the count on hover. The rows
  are not clickable yet (`deathsPerLevel`, `src/stats/statsPage.ts`), and the page loads
  none of the game's code (`tools/checks/build.ts`): the reader of a `dungeon.dat` it needs
  must stay out of the game's chunk, or the bound there be raised knowingly.

Paying it: the heat map, checked in `tools/probe-frames.ts`'s statistics block (a level
opens its map) and by a screenshot over the dev server's fortnight.

### E22 ⏸️ Fullscreen filled by a fraction

Waits on the author: whole multiples satisfy them on the devices they tried, and the item
is taken if players ask for a screen that fills theirs. Until then it records the
analysis the decision needs.

**Now.** In fullscreen the screen is the largest whole multiple that fits of 320x200 at
16:10, or of 320x240 at 4:3 (DISPLAY's ASPECT RATIO), counted in device pixels and centred
on black (`fit`, `src/lib/fullscreen.ts`). The fill would scale it by a fraction instead,
to the screen's height or width, whichever is reached first.

**What it would gain**, as the share of the limiting side the whole multiple leaves used:

| Screen, device pixels | 16:10 | 4:3 |
| --- | --- | --- |
| 1366x768 | 3x, 78% | 3x, 94% |
| 1280x800 | 4x, 100% | 3x, 90% |
| 1920x1080, and 1536x864 at a device ratio of 1.25 | 5x, 93% | 4x, 89% |
| 2048x1536 (a 4:3 tablet) | 6x, 94% | 6x, 94% |
| 2560x1440 | 7x, 97% | 6x, 100% |
| 2880x1800 (1440x900 at 2) | 9x, 100% | 7x, 93% |
| 3840x2160 | 10x, 93% | 9x, 100% |

Most screens lose under a tenth of a side. Small screens lose most, 1366x768 at 16:10
above all, and 4:3 on a screen of 1080 lines.

**What it would cost:**

1. **Without the CRT effect, uneven pixels.** Under `image-rendering: pixelated`, a size
   that is not a whole multiple draws some pixels a display pixel wider or taller than
   others. 4:3 already accepts it vertically: each line is 6/5 of the multiple tall, so
   lines are even only when the multiple is itself a multiple of five.
2. **With the effect, no uneven pixels, but the scanlines.** The effect's canvas redraws
   at whatever size it is shown, in device pixels, and its shader stretches to any ratio,
   so a fill costs nothing there but this: the beam is sampled at each pixel's centre
   (`line` and `beam` in the shader, `src/lib/crt.ts`), exact only at a whole number of
   display pixels per line. At 3 per line every gap falls alike; at 3.6 or 5.4 each line
   is sampled at another phase, a faint uneven banding, worst between two and four pixels
   per line, and below two the lines are noise. The screen meets it already without a
   fill: 3.6 pixels per line at 4:3 in the window (960x720), 4.8 at 4:3 in fullscreen on a
   1080-line screen, and 3.75 at 16:10 in the window at a device ratio of 1.25, since the
   window's 960x600 is counted in CSS pixels. Whether it shows has not been looked at. The
   cure is the beam integrated over each pixel's height instead of sampled, and the
   scanlines faded out below about 2.5 pixels per line.
3. **One source for both canvases.** The CRT effect's canvas shares `#game`'s grid cell
   and the `.screen` class with the game canvas, so it covers it only while both take
   their size from `#game`'s `--screen-width` and `--screen-height`, which `fit` sets. A
   size set inline on one canvas, or a class changed on one (`createCrtEffect` copies the
   class once), leaves the effect off the game canvas while the pointer, read from the
   game canvas's own rect (`canvasPoint`), stays right: a picture off its clicks.
4. **The probe.** `tools/probe-frames.ts` pins the whole multiple, centred, at 16:10 on a
   1920x1080 and a 1366x768 screen, and at 4:3 on the 1366x768 one. A fill adds the same checks at a fraction:
   the effect's canvas over the game canvas exactly, and the pointer read through the
   curve.

**The choices**, cheapest first:

- **Not at all**: the item is deleted. Item 2's banding stays a question of its own, for
  the 4:3 and the window cases above.
- **Filling only with the effect on**, where no pixel is uneven: item 2's cure first, then
  `fit` takes the fraction when the effect is shown. No new setting.
- **A DISPLAY setting, FILL**, off by default, with or without the effect: item 1's
  uneven pixels are then the player's choice.

The second is the recommended one if players ask: it fills the screens that lose most at
no cost in pixels, and the scanline cure it needs is wanted for 4:3 anyway once it is
seen to band.

---

## C — Known divergences from CSBWin

A divergence found along the way goes here, with the next free ID.

### C194 ⏳ A DSA's wall graphic counts as a real decoration, so it hides no text

`SummarizeRoomInfo` gives a face with a visible text and no real decoration no decoration
at all (`doc/CSBwin-src/Codea59a.cpp:172-179`). A DSA's extended graphic is written to
`rslt->decorations` without `realDecoration` (`:113-127`), so under a text it is dropped.
The port sets `realDecoration` for it too (`src/renderer/csbwin/SummarizeRoomInfo.ts`, the
type 47 branch), so it draws both. No face of a set here holds a visible text and a DSA
graphic without another actuator, so nothing shows it yet. Paying it: drop the line, and
prove it on a face made in a tool.

### C195 ⏳ Wall texts skip `TranslateWallLanguage`, which makes every code from 28 a space

Before a wall text is drawn, `DrawWallDecoration` passes it through `TranslateWallLanguage`
(`doc/CSBwin-src/CSBCode.cpp:3292`, `Translation.cpp:196-218`): codes 0-25 become `A`-`Z`,
26 a space, 27 a period, 128 a newline, and every other code `'A' + code`. The result is
looked up in `Translation.txt`'s table, unchanged without one, then turned back: `A`-`Z`,
newline and period as they were, **anything else 26**. So with or without a translation
file, a code from 28 to 127 is drawn as a space. The port has no `TranslateWallLanguage`
and draws the code's glyph. No wall text of the English sets or of Conflux holds such a
code. 13 of `dm-atari-1.3-fr`'s do, and CSBWin would show each of those codes as a space. `tools/checks/wall-text.ts` part 3 asserts what a
code past the font draws, which CSBWin never reaches. Paying it: port the round trip
without a table (G21 holds `Translation.txt`), and decide with the author whether the
French set keeps its letters, a deliberate divergence under H.

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

New verification debt goes here; it can be taken anywhere ("Priority", point 5).

### F22 ⏳ `tools/checks/replay.ts`: a game logged at the boundary plays back the same

Nothing proves the game a function of its start, its VBLs and the log of its input
boundary (`Game.input`, `src/engine/InputBoundary.ts`), which G29 rests on. Paying it: a headless tool with the screen's interface (`tools/lib/ui.ts`), since a
click in the viewport is resolved through the picking the tick's `DrawViewport` leaves. It
plays a scripted game, from a new game and from a save, its inputs coming between uneven
numbers of VBLs a wake: clicks and moves, a panel key, an attack and its flash, a dialog's
pause, a settings change, a save with the clock running and one with it stopped. It logs it
at the boundary, plays the log back in a fresh `Game`, and asserts `d.Time` and
`d.RandomNumber` equal at every logged change and the two final saves byte-identical. The
recorded run composes the screen at moments the replay does not, as pointer moves and
dialogs do, so the tool also proves that nothing the page draws takes from the game's
stream (`doc/RECORDING.md` → "What is not verified"). Size M; a divergence it finds is an
item of its own.

### F21 ⏳ 3D2D1D's walkthrough is not replayed through `Game`

`doc/3D2D1D_WALKTHROUGH.md` is a full route through 3D2D1D, computed by
`tools/solve-3d2d1d.ts` from a model of CSBWin's moves, gravity, teleporters and four DSA
commands, outside the engine. `tools/checks/watch-3d2d1d-gravity.ts` replays its first two legs
through `Game`, moves alone, and each comes to rest where the walkthrough says. The rest
needs what those legs do not: the clicks on the mirror, the switches, the levers and the
keyholes; the waits for a door, a false wall or a teleporter; the 1D corridor's DSA chain,
which a hand probe ran correctly but no tool proves; and map 6's Screamers, which the model
pins to one square where the engine moves them. Paying it: a `tools/checks/watch-*.ts` that reads the
walkthrough's key blocks and its clicks, plays them through `Game` on the real files, and
checks each resting square and the three gold keys, then the end. Size M; where the route
and the engine part, CSBWin decides which is wrong.

---

## G — Unported CSBWin features

Things CSBWin does that the port has not built. These are not defects in existing code;
they are listed so nothing is lost. The active ones come in the index's order; the
postponed ones follow, under their own heading (see "Priority").

### G29 ⏳ Recording a game and playing it back

CSBWin records a game as the mouse-queue entries it takes, each with its tick and
`d.RandomNumber`, and plays them back in place of the queue (`RECORDFILE` and `PLAYFILE`,
`doc/CSBwin-src/Recording.cpp`). `doc/RECORDING.md` holds how both work, what a replay
needs, where the port stands against it, and the port's own recorder.

The port has neither. It keeps only the recorder's count, `totalMoveCount`, which a save
stores (`Game.recordFileRecord`, `src/engine/Game.ts:1043`), and `extraTicks` is always on
(`src/engine/MovementSystem.ts:115-116`). Conflux 3.5's `AutoRecord` (`doc/RECORDING.md`)
asks for a recorder the port does not have.

**The port's recorder is its own** (`doc/RECORDING.md` → "The port's recorder"): it logs
the input boundary's changes (`src/engine/InputBoundary.ts`), each with the count of VBLs
before it, where CSBWin logs the queue's entries with `d.Time`. Counted in VBLs, nothing that happens within a tick needs proving,
and playback needs no `extraTicks` off. `d.Time` and `d.RandomNumber` go with every change,
so a replay stops at the first that drifts. Playing CSBWin's own recordings back, which
needs the port's draws to follow CSBWin's draw for draw, is not part of it.

It comes after F22. A change to what the engine does makes older recordings
drift: each carries the build that made it, and the drift detector shows where it parts.

Paying it, in steps:

1. The recorder. The start: a new game's data set, rules and extras, and its stream and
   `d.RandomGameID` as `GameSaves.newGameRead` leaves them, since it draws again while a
   save of the set holds the id (`src/engine/GameSaves.ts:257-267`); or the save a game was
   read from. Then the boundary's log. A read ends a recording.
2. The store: recordings beside the saves in IndexedDB (`src/data/saves/BrowserSaveStore.ts`).
3. The player: the boundary fed from a recording (`InputBoundary.apply`, before the
   VBL each change was logged at), the page's live input ignored but its own controls,
   every tick it plays drawn, at the wall clock's pace or faster. The boundary logs the
   game's changes, not the interface's: a dialog a played VBL opens (the disk menu, from
   its icon) holds the clock, and the logged `pause` lets it run, but the player takes the
   dialog down itself.
4. Where a player starts, stops and plays one, to design with the author. Sharing
   (`doc/RECORDING.md` → "Shared recordings") comes after.

### Postponed

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
image is the collection's `Floppy Disks STX/Dungeon Master for Atati ST v1.3 (French).stx`
(gitignored; `doc/ATARI_ST_DISK_REFERENCE.md` → "The disks", "The French 1.3 disk"). The
program is presumably `START.PAK`, packed and not yet examined, whose 1.3 differs from
1.2's, so it must be unpacked before its strings can be read. It holds only what the 1988 program printed: the CSBWin-only messages (the save
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
(`readGame`), so what is missing is what the file does not hold: the graphics
and the tables read from `graphics.dat`, which the player would pick from the known
dungeons' (the signatures an Extended Features block may carry,
`doc/CSBwin-src/SaveGame.cpp:380-381`, could suggest one); a `dungeon.dat` for "RESTART
THIS GAME", so a lost game can only load a save; and a data set to list its saves under,
which its signature can stand for.

---

## X — Extras (not in CSBWin)

Features from later versions of the game or from elsewhere, which the author wants in
time. Postponed (⏸️) like the G items under "Postponed", and taken only when the author
names one.

Rules for all of them:

- **One setting each, off by default**: a flag of `SettingsValues.extras`
  (`src/settings/Settings.ts`), which the game reads as `GameContext.extras` (`Extras`),
  set at every change (`applyToGame`). With every extra off, the game is CSBWin's: every
  tool's output and every golden frame stay the same. The settings dialog's GAME tab
  shows each, a button of its own (`src/renderer/ui/SettingsDialog.ts`):
  - `drinkAtFountain`: an empty hand drinking at a water fountain (`drinkAtWaterFountain`,
    `src/renderer/ui/Feeding.ts`, checked by `tools/checks/fountain.ts`);
  - `colourNewMastery`: a mastery just gained drawn in colour 7 on the attribute panel until every attribute
    its level gain raised is back at the maximum that gain gave it, whatever another
    role's level raised since (`src/engine/MasteryGains.ts`,
    checked by `tools/checks/mastery-panel.ts`);
  - `gatherThrownWeapons`: what a champion's THROW or SHOOT sent off gathered back into their possessions when
    the party arrives on the square it lies on, never what the cursor threw: into the
    slot it left, else the quiver, its small-weapon slots first and the object fewest
    slots take first, so a club gathered with daggers keeps slot 12, then the pack
    (`src/engine/ThrownWeapons.ts`, checked by `tools/checks/watch-thrown-weapons.ts`);
  - `showItemProperties`: an item's figures in the eye panel, under CSBWin's description
    (`getItemPropertyLines` and `placeItemPropertyLines`, `src/renderer/ui/Objects.ts`,
    checked by `tools/checks/item-properties.ts`). Its lines come in a fixed priority order,
    anchored at the bottom: the first at viewport y 122, the next 7 rows up, a line whose
    row would be at or above CSBWin's last dropped with every line after it, so each line
    of an item type keeps its row. CSBWin's lines never move. A line is one labelled
    figure, at most 18 characters so it never wraps (`DAMAGE 10`, `ARMOUR 9 SHARP 2`,
    `FOOD 500 OF 2048`): the item's own value from the set's own tables (`ObjectTables`), not a
    figure worked out for the selected champion, and a rule CSBWin keeps in code is
    called, not copied. An object whose description a viewing filter's `&DESCRIBE`
    rewrote shows none. A weapon's lines are `DAMAGE` its `WEAPONDESC.uByte2`; what
    carrying it gives in any slot, from the rule `AdjustStatsForItemCarried` applies
    (`itemCarriedAdjustment`, `src/engine/AdjustStatsForItemCarried.ts`), so a cursed
    one gives `LUCK -3`, then what it adds to the masteries in the weapon hand or round
    the neck, from `DetermineMastery`'s (`possessionMasteryBonus`, `src/engine/skills.ts`):
    `ALL SKILLS +1` for the Firestaff, `HEAL SKILL +1` for the Sceptre of Lyf; `MISSILE` its `uByte3`, unless 0; what a launcher shoots or
    what an ammunition is for (`ammunitionClassFor`, `src/engine/CharacterSystem.ts`: a
    launcher of class 16-31 fires class 10, one of 32-47 class 11), named by the set's
    first weapon of the class; then a torch's `LIGHT`, `d.Word1074[charges]`, or the
    `CHARGES` of a weapon whose `legalAttacks` row withdraws an attack once they are
    spent. `word4`'s low byte gets no line: the one figure made from it, a shot's damage,
    is overwritten on the next line (`doc/PROVEN_FACTS.md` → "`atk_SHOOT` throws away the
    damage it computes"). Golden frame 30 shows the eye on HALK's weapon. A garment's
    lines are `ARMOUR` its `ClothingDesc.uByte1` and `SHARP` its `uByte2 & 7`, one space
    apart (the Plate of Darc's armour is 160); `SHIELDS ALL PARTS` for one whose `uByte2`
    bit 7 is set (`TAG01680a`); what wearing it gives, from the same rule as a weapon's;
    then what boots give on the feet, `MAX LOAD +1/16` and `MOVE TIME -1` (`feetMaxLoadShift`
    and `feetMoveTimeBonus`, `src/engine/CharacterStats.ts`). A misc object's are what
    eating food gives, `FOOD` its `d.FoodValue`, or a gulp from a waterskin that is not
    empty, `WATER 800` (`WATERSKIN_GULP`, `src/engine/Feeding.ts`), each `OF 2048`, the
    cap of a champion's food and water; then what carrying it gives (the Rabbit's Foot,
    a Jewel Symal, the Moonstone) and what it adds to the masteries round the neck (the
    Pendant Feral, the Ekkhard Cross, the Gem of Ages, the Moonstone); then an
    Illumulet's `LIGHT`, the `d.Word1074[2]` it adds to the party's brightness round the
    neck (`isIllumulet` and `illumuletLight`, `src/engine/CharacterSystem.ts`). A potion's are `POWER` its power, then what drinking
    it does, from `potionEffect` (`src/engine/Feeding.ts`), the half of CSBWin's switch
    that reads the potion alone: the attribute it raises, `CURES POISON`, the stamina or
    the health it gives back as a fraction of the maximum (`STAMINA +MAX/3`),
    `HEALS WOUNDS`, the shield it gives a champion shielded at 50 or less, or the mana
    it gives below the maximum. Only where the eye shows a potion's power as a rune
    (`showsPotionPower`: to a selected champion of priest mastery above 1); to anyone
    else a potion has no line. A water flask has no rune, and gives its
    `WATER 1600 OF 2048` to all.
  - `unlimitedKeyQueue`, UNLIMITED KEY QUEUE, for time attacks: the mouse queue a ring of
    `LONG_MOUSEQLEN`, 101, not `MOUSEQLEN`'s 8, so a hundred keys wait, not seven, and a
    click is refused only while 99 wait. Every rule of CSBWin's queue is kept, its
    lengths alone changed, as CSBWin's own `NoKeyQue` changes them
    (`doc/CSBwin-src/Data.h:1528-1533`); a bump still throws the whole queue away. The
    setting reaches the queue through `applyToGame` (`MouseQueue.setLength`), which
    empties it where the length changes (`src/engine/MouseQueue.ts`, checked by
    `tools/checks/mouse-queue.ts`, case 1b).

  The coloured object cursor, RISE's NEW FACE and the FTL logo are the exceptions: the
  author wants them on by default, so they are recorded under H.
- **What an extra saves goes in `EXPOOL`, under a type of its own**, from `0xF0` up, and
  nowhere else in the file. CSBWin reads such a record with the pool, never looks at it,
  and writes it back unchanged (`doc/PROVEN_FACTS.md` → "CSBWin carries an `EXPOOL`
  record of a type it does not know through a load and a save"), so the file stays a
  CSBWin save both ways. A record holds at most 29 longwords; more takes several keys
  that differ only in their index, as CSBWin's DSA global variables do. The extra writes
  its records only with the setting on, so with it off every save is byte-for-byte what
  it was. Before writing, it `Read`s (which deletes) its old records from index 0 until one
  is missing, then `Write`s the new ones, as CSBWin's save does with its palette
  (`doc/CSBwin-src/SaveGame.cpp:1229-1230`). A load reads them whatever the setting.
  A record can come back from a game CSBWin played on without updating it, so a load
  checks every value against the world and drops what does not hold. The types in use
  are listed in the entries below. The shipped extras above save nothing: a save and a
  load forget what they keep.
- **Each ships with its `tools/checks/` tool**, run with the setting on, and its entry here is
  deleted as for any paid item.

### X9 ⏸️ Thrown weapons' tags kept across a save

The tags of `src/engine/ThrownWeapons.ts` live only in memory, `GameContext.thrownWeapons`,
and a load clears them (`src/engine/RuntimeSave.ts:182`). A tag holds the record it was
made for, and `tagOf` keeps it only while the object's RN still names that very
`DatabaseRecord`. A loaded world has new records, so that check cannot survive a save.

- **The records**: type `0xF0`, subtype 0, index from 0. Two longwords a tag, so fourteen
  to a record:
  - the object's `ObjectID`, the thrower's index and the slot the object left;
  - where it is at the save: the level, x and y of the chain that holds it, on the
    floor or in the missile or monster group there that holds it. That longword also
    carries the object's `DescIndex`.
- **The load** keeps a tag only if that chain still holds the RN and the RN's object
  still has that `DescIndex`. This drops the tag of an object CSBWin moved, gave a
  champion, or whose slot it freed and handed to another object, as
  `findEmptyDBEntry` does in the port. A tag kept takes the object's new record as its
  `record`.
- **The check**: `tools/checks/watch-thrown-weapons.ts` goes on through a save and a load: a
  weapon thrown, then the file saved and read back, then the party on its square gathers
  it. The same file with the weapon moved to another square by hand loads with no tag,
  and with the records deleted, it loads as if nothing had been thrown.

### X10 ⏸️ The cells the party has seen, kept across a save for an automap

Nothing records which cells the party has seen. This item records them and saves them;
drawing a map from them is a separate item, entered when the author names it.

- **Seen means drawn, and the cell keeps the aspect it was drawn with.** The cells
  `DrawViewport` summarises at a tick (`SummarizeRoomInfo`,
  `src/renderer/csbwin/SummarizeRoomInfo.ts`) are recorded with what the summary made of
  them, not what the map holds. A fake wall seen closed is stone. A hidden pit is
  floor, since the summary makes it `OPEN`. An invisible teleporter is floor too: its
  `decorations[0]` is 0, so it is not drawn. Nothing a designer hid is given away. The latest view of a cell replaces the
  earlier one. Recording runs whatever the setting, so a map is there when the extras are
  turned on.
- **Four bits a cell.** Codes 0 to 7, to settle when the item starts: unknown, stone,
  floor, pit, stairs up, stairs down (the summary's `decorations[0]`, `cellFlags & 4`),
  door, teleporter. 8 to 15 are free for what comes up along the way.
- **Still to decide**: what a cell is when the viewport is too dark to show it, and
  whether the cell the party stands on counts as seen without being drawn.
- **The records**: type `0xF1`, subtype the level, index the chunk: the level's cells in
  the map's own order, eight to a longword, 29 longwords (232 cells) to a record. A chunk
  that is all unknown is not written. The default dungeon's 12087 cells make about 6 KB
  of data, about 55 records.
- **The check**: a new `tools/checks/automap.ts` walks a route on the default dungeon and
  prints each level's codes as a map. It asserts a fake wall seen as stone and a hidden
  pit seen as floor, saves, loads, and compares every code. The same file with the
  records deleted loads with every cell unknown.

### X16 ⏸️ The map's info follows a DSA's program to the squares it names

The map dialog's info (`src/engine/CellInfo.ts`) shows a DSA by its description and
state, and follows an actuator's target to its square, but not a DSA's: a DSA acts on
the squares its program names, and the info names none of them, in either direction.
Conflux and the fans' dungeons do most of their work in DSAs, so there the info says
least where it is most wanted.

- **What to read**: a program's location constants, the words an operation takes as a
  location (`LOCATIONREL`, `LOCATIONABS`, `doc/CSBWIN_DSA_REFERENCE.md`), told from any
  other constant by the operation that pops them, over the census's decoder
  (`decode`, `src/engine/DungeonCensus.ts`), which knows each command's operands.
- **What it gives**: under a DSA, the squares it acts on, as links; under a square, the
  DSAs whose programs name it, under "Acted on by". A location computed at run time is
  not followed, and the info says so rather than guess.
- **The check**: `tools/checks/map-cell-info.ts` on a Conflux DSA whose program names a
  square, both ways.

### X17 ⏸️ The map's info names a Hall of Champions mirror's champion

A champion's record is a hidden text on the floor before its mirror, which the mirror
(actuator type 127) reads when the party recruits. The map's info shows the mirror as
"Champion mirror" and the record as a hidden message, its raw words: the name, then the
encoded attributes and skills (`AZIZI JOHARI F AADNADACAAAH…`).

- **What it should say**: the mirror, its champion's name and title, and whether the
  mirror is spent (`PORTRAIT_InActive`, `src/data/actuatorHelpers.ts`); the record
  under the floor square not as a message but as that champion's, or left out.
- **What to read**: where CSBWin finds the record for a mirror (the square, the text),
  and how it splits the name from the rest, from `AddCharacter`
  (`src/engine/AddCharacter.ts`, `HeroExtractor`), cited there.
- **The check**: `tools/checks/map-cell-info.ts` on a mirror of DM's Hall of Champions
  and the square before it.

### X18 ⏸️ The scents compared with a square on every set: the Atari's bug fixed

Not decided: whether the port should be faithful to the Atari's implementation, as it is
now, or to what FTL meant, as its later releases are. The author decides; until then
nothing changes.

**The Atari's bug.** Every Atari program, DM 1.0 to 1.3 and, by ReDMCSB, CSB 2.0 and 2.1,
compares each scent with the square and throws the result away, in
`F0317_CHAMPION_AddScentStrength` and in the ten-second decay (ReDMCSB's `MEDIA007`,
`BUG0_00`, `doc/ReDMCSB-src/CHAMPION.C:1497-1507`, `:2311-2330`;
`doc/ATARI_ST_DISK_REFERENCE.md` → "The scents in the program"). `dm-atari` and every set
but `dm-amiga` play it (`src/engine/PartyFootprints.ts`). What it does in play:

- **Every strength is 24 after every move.** A move calls `F0317` twice
  (`MOVESENS.C:772`, `:783`): first with the time spent on the square left, which sets the
  whole trail to `min(80, strength + time)`, then with `0x8018`, whose first strength is the
  new print's, 0, so the whole trail becomes `max(0, 24)`. The time the party spent
  anywhere is lost; the first call does nothing that lasts.
- **The decay lowers every print but the newest by one**, the party's square too. After
  24 decays without a move the oldest reaches 0 and is dropped, and since the rest reach
  0 in the same update, the trail falls to the newest print at once.
- **What a monster smells** (`GetBestMonsterFacingP1`, `doc/CSBwin-src/Monster.cpp:613-625`,
  `src/engine/MonsterPerception.ts`): out of direct reach, on a square of the trail, it
  follows the trail when `Random(0..3) + strength > 30 - 2 * smellingDistance`, the
  strength of its own square's print. With every strength 24 just after a move, a nose of
  1 never follows, 2 follows one time in four, 3 three in four, 4 and more always; each
  decay since the last move takes one from the strength, whatever the square.

**What the later releases do.** The IIGS's and the Amiga's (`MEDIA353`) compare the
location, the later ports' (`MEDIA529`) the whole scent word, which is the same thing:
`F0317` changes only the strengths of the prints on the square it is given, and the
decay spares the print on the party's square. `dm-amiga` plays it (`byLocation`,
`GameContext.ts`: `tables.amigaSounds !== null`; `doc/AMIGA_DISK_REFERENCE.md` → "A22E's
own code, classed"). It is not what FTL meant either: its pointer walks the prints up from
the oldest while its index walks the strengths down from the newest, so it compares print
`k` and writes strength `N-1-k`. A print's strength is its own only at the trail's middle;
`tools/checks/amiga-scents.ts`'s walk S0, S1, S2, S1 leaves `24 0 24 0`, S1's two prints
at 0 and the others at 24.

**The choices**, each S:

1. **Leave it**: every set plays its own release's code, the Atari's bug on the Atari's
   sets. Nothing to do but delete this item.
2. **The later releases' code on every set**: `byLocation` true for all. Faithful to an
   FTL implementation, mirror included. Either a deliberate divergence (H), or an extra
   (X), a setting off by default under the rules above.
3. **What FTL meant**: print `k`'s strength written at `k`, the time spent on each square
   kept. No release does it, so it is the port's own invention, and goes in as an extra if
   at all.

A save holds the strengths and not the rule, so a save read under another rule plays on.
The check: `amiga-scents.ts` for the strengths, and a monster with a nose of 2 or 3 left
on a trail the party walked slowly, followed or not as the rule says.

---

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

- 🚫 **What only the Amiga does follows ReDMCSB, not CSBWin.** CSBWin ports the Atari ST
  release and has none of the Amiga's own: its 8-bit sounds and their table, a group heard
  moving, the volume by position in stereo, its palettes, ornament coordinates and
  creature replacement colours. For those alone, the
  `dm-amiga` set follows ReDMCSB's A22E branch (`doc/ReDMCSB-src/`,
  `doc/AMIGA_DISK_REFERENCE.md` → "The reference: ReDMCSB, A22E"), and its tables are read
  from the Amiga's `dm`. Its colours are shown at the Atari's 3 bits a channel, which
  loses none of them: each of `dm`'s channels is twice an Atari intensity, or 15 for 7.
  Everything CSBWin has, the Amiga set does as CSBWin does, where A22E does it otherwise
  too, but four things the author asked for: the wall bump asked for on the square bumped
  into, the scents compared with a square, the ending's six explosions after its last
  message and the dialogs' "V2.2". Kept as CSBWin has them: the couatl's picture is CSBWin's aspect, the click
  areas are the Atari's (A22E's RESURRECT, REINCARNATE and
  CANCEL are smaller, and its names open the inventory a pixel further left). An object
  held over the viewport keeps its colours, as A22E's pointer, a hardware sprite, shows
  it: that is the port's on every set, "An object in hand keeps its colours over the
  dungeon view" below, not the Amiga's.
  `doc/AMIGA_DISK_REFERENCE.md` → "A22E's own code, classed".

- 🚫 **The keys are the port's table, not a `config.txt`.** CSBWin's keys are whatever
  its `config.txt` says (`doc/PROVEN_FACTS.md` → "CSBWin has no keyboard controls"). The
  port's are `DEFAULT_KEY_BINDINGS` (`src/renderer/ui/Keyboard.ts`): two
  `KeyboardEvent.code`s an action, and a key bound to no action does nothing, the
  Reincarnate screen's typing and the save menu's keys aside. Its default is the shipped
  file's keys at their places on a US keyboard, with three differences, the author's
  choice: 7-0 open the inventories, which the file leaves unbound; the arrows, Home and
  PgUp are not moves, where the file's keypad scancodes make the up, left and right
  arrows keypad 8, 4 and 6, Home keypad 7 and PgUp keypad 9 (the moves keep two keys, a
  letter and the keypad, and the arrows have no turns); and the letters are bound by
  position, where the file's `key` lines bind characters. Return wakes no one, as under
  the file. The settings' KEYS tab offers two other presets, KEYPAD and ARROWS
  (`KEY_PRESETS`), and a table of the player's own, kept with the settings.
  `tools/checks/key-bindings.ts` checks every default key.
- 🚫 **Esc opens the settings, and Pause freezes.** CSBWin's tables bind the Atari
  keyscan of Esc, 0x1b: awake and asleep to the freeze, 147, and frozen to the thaw,
  148 (`Byte18400`, `Byte18440`, `Byte18448`, `doc/CSBwin-src/Mouse.cpp:1870-1912`), and
  the shipped `config.txt`'s one other `KEY` line sends it from Esc. The port's `freeze`
  action sends that keyscan from Pause (`DEFAULT_KEY_BINDINGS`), and Esc opens the
  settings dialog, awake, asleep and frozen alike (`GameInput.keyDown`,
  `src/renderer/ui/SettingsDialog.ts`). A left click on the pixel x 0, y 198 still
  freezes, and a click anywhere still thaws. `tools/checks/settings-dialog.ts` and
  `tools/checks/freeze.ts` check both keys.
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
  `tools/checks/extended-dungeon.ts` checks that a 3D2D1D save keeps both of its own. 3D2D1D
  is the only dungeon here that sets any of them.
- 🚫 **A game read starts the gravity afresh.** CSBWin's gravity keeps three globals,
  `nextGravityMoveTime`, `moveHistory` and `gravityMove` (`doc/CSBwin-src/data.cpp:245-247`),
  which `SaveGame` does not write and nothing resets, so a load keeps the last game's
  history, where a fresh program starts from `{0,1,2,0}`. `moveHistory` decides which way
  a slide goes (`GravityMove`, `Mouse.cpp:1269-1301`), so in CSBWin the first slide after
  a load depends on what was played before it. The port gives every game read the
  program's start, `{0,1,2,0}` and at rest (`Game.installReadState`): the same save
  slides the same way whatever came before. Three moves of the player's, one along each
  axis, give either the same history. F5 is refused during a slide ("CANNOT SAVE NOW"),
  where CSBWin's queue throws the disk icon's click away (`:1482-1491`), so no save
  holds a slide. `tools/checks/watch-3d2d1d-gravity.ts` checks the read.
- 🚫 **The data set chooses DM's rules, not the player.** CSBWin's "DM Rules" menu item
  toggles `DM_rules` at any time (`doc/CSBwin-src/CSBUI.cpp:933-935`), and its Linux build
  takes `--dmrules` at the launch (`LinCSBUI.cpp:677`). The port has no toggle: a file's
  Extended Features block sets the rules (`readRulesOptions`), and where it has none the
  manifest's `dmRules` gives `DMRulesDesignOption` its value at the start
  (`DataSet.dmRules`, `src/data/DataSets.ts`), which the boot turns into `DM_rules`. The
  three DM sets on the Atari files carry it, as CSBWin's own DM package carries `DMRules`
  in its block (`doc/PROVEN_FACTS.md` → "`DM_rules` and `DMRulesDesignOption`…").
  `tools/checks/dm-rules.ts` checks that `dm-atari` boots with `DM_rules` on, and
  `tools/checks/data-sets.ts` that no set with a block is given the flag.
- 🚫 **The canvas shows an Atari intensity times 36, not RGB555.** CSBWin hands Windows
  RGB555 pixels, its straight palette each intensity `i` as five bits `(i << 2) | (i >> 1)`
  (`CreateOverlayTable`, `doc/CSBwin-src/Graphics.cpp:3096-3117`), which Windows widens to
  8 bits as `(v << 3) | (v >> 2)`: intensities 0-7 show as 0 33 74 107 148 181 222 255.
  The port's canvas shows them as `i * 36`, 0 36 72 108 144 180 216 252
  (`atariIntensity`, `src/renderer/csbwin/CanvasBlitter.ts`, and `atariToRGB`,
  `src/core/types.ts`), up to 6 a channel apart. Only
  the viewport through an overlay, a tint or a jitter is CSBWin's RGB555 widened
  (`src/renderer/csbwin/OverlayScreen.ts`), so while one is up the viewport and the panels
  show the same Atari colour up to 6 a channel apart. `tools/checks/overlay-screen.ts` prints
  both. To revisit when frames are compared with CSBWin's ("Priority", postponed):
  the golden frames hold palette slots, not colours (`tools/lib/frames.ts`), so RGB555
  on every screen would move none of them.
- 🚫 **An object in hand keeps its colours over the dungeon view** (X4). CSBWin draws the
  cursor rows from screen row 29 down as the object's colour-4 silhouette while the view
  is shown (`doc/PROVEN_FACTS.md` → "An object in hand is a colour-4 silhouette over the
  dungeon view"). The port draws the icon itself and shows those pixels through the
  interface palette, so neither the light nor the level's monster colours reach it
  (`drawCursorItem`, `src/renderer/ui/Mouse.ts`, and `ScreenComposer.presentViewport`). The
  arrow over the right-hand panel and the message area is kept. It is
  `UIState.colouredObjectCursor`, on by default. It becomes one of the player's settings
  (`src/settings/Settings.ts`) once a tab of the settings dialog carries it; `tools/checks/object-cursor.ts` checks it both ways.
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
  (`doc/CSBwin-src/CSBCode.cpp:3603`), compensates for `MakeMirror` reversing a buffer
  of whole groups of 16 pixels. `getMirroredBitmap` reverses the exact bitmap, so applying
  it would shift a correctly aligned image. Neither a basic decoration nor a
  `CSBgraphics.dat` one applies it (`DrawWallDecoration` and
  `drawExtendedWallDecoration`, `src/renderer/bytecode/DrawDecorations.ts`), and each of
  Conflux's draws at 1, 6 and 11 the mirror image of itself at 0, 5 and 10, as CSBWin's
  does (`tools/checks/extended-decorations.ts`, section 3).
- 🚫 **`MakeBigActuators` reads the actuator's type, not CSBWin's byte-order slip.** CSBWin
  converts the actuators of a file without the `BigActuators` flag before their byte swap
  (`doc/CSBwin-src/SaveGame.cpp:2813-2820`), so it takes bits 8-14 of `word2` for the
  type where the port takes the type itself (`doc/PROVEN_FACTS.md` → "`MakeBigActuators`
  runs before the byte swap"). The two differ only for a type-47 actuator under either
  reading: DM has none, Conflux's file has the flag, and `tools/checks/dungeon-conversions.ts`
  fails for a dungeon that has one.
- 🚫 **The scents' two loops are the Atari's, not CSBWin's.** CSBWin's `AddFootprintEntry`
  walks the strengths `while (index-- != 1)` (`doc/CSBwin-src/Code11f52.cpp:4394`), so it
  never writes strength 0, and its ten-second decay `break`s after dropping the oldest print
  (`doc/CSBwin-src/Code17818.cpp:194`). ReDMCSB writes `while (L0954_i_ScentIndex--)` and
  `continue` for every release, the Atari's among them (`doc/ReDMCSB-src/CHAMPION.C:1501`,
  `:2323-2324`), and so does every Atari DM program, 1.0 to 1.3: 1.2 English tests the index
  before decrementing it (`START.PAK` text `$169ac`) and branches back to the loop's test
  after the deletion (`$1768a`), its helpers the larger and the smaller of two words
  (`doc/ATARI_ST_DISK_REFERENCE.md` → "The scents in the program"). CSB's Atari program is
  on no fixture; ReDMCSB's S20E and S21E share the lines. Every set plays the Atari's loops
  (`src/engine/PartyFootprints.ts`, `tools/checks/amiga-scents.ts`,
  `tools/checks/magic-footprints.ts`). The comparisons thrown away stay: they are the
  Atari's, ReDMCSB's `BUG0_00`.
- 🚫 **A kill of `alternateGraphics` 4 to 7 is counted nowhere.** `ProcessMonsterDeleteFilter`
  indexes the kill statistics' four longwords with the three-bit subtype unchecked
  (`doc/CSBwin-src/Code11f52.cpp:990`, `:995`): a new record's count goes into the stack past
  its array, an existing one's into the pool past the record. The port writes the record
  of zeros and raises no count (`MonsterDamage.processMonsterDeleteFilter`).
- 🚫 **`CHARDESC.load` is recomputed** from the possessions, and the object in hand for the
  cursor's owner, rather than cached and adjusted at each of CSBWin's possession writers
  and `SetHandOwner`; a save file's without the hand, as `SaveGame` writes it. Same value,
  and it cannot drift. `tools/checks/hand-owner.ts` checks the hand's share; recorded in the module comment of `src/engine/CharacterStats.ts`.
- 🚫 **`_FlashAttackDamage` does not stop the game, and lasts two ticks.** CSBWin's ends in
  `VBLDelay(15)`, which halts everything for a quarter of a second, and the tick due by
  then draws the buttons over the damage (`doc/CSBwin-src/Attack.cpp:1039`,
  `CSBCode.cpp:8950-8958`). The port holds the panel's redraw back while the game keeps
  running, as it already does for the feeding animation. The author's decision is 24
  VBLs, 400 ms (`ATTACK_FLASH_VBLS`, `src/engine/AttackMenu.ts`), over one tick and under
  two, so the text can be read: the damage is up for two ticks, half a second, where
  CSBWin's is up for one. The count is the engine's, run down by every VBL
  (`Game.runFrame`), so a replay of the same inputs holds it alike. The keys still open
  an attack menu over it, which ends the flash. `tools/checks/attack-panel.ts` checks that
  the first tick after the flash leaves it up.
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
  CSBWin's. `tools/checks/fusion.ts` checks it from a strip that has printed nothing and
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
  `src/engine/Chaos.ts`; `tools/checks/new-adventure.ts`).
- 🚫 **RISE raises DM's champions with the utility disk's portraits** (X8). CSBWin's
  utility copies a champion's portrait as the saved game holds it (`TAG002724`,
  `doc/CSBwin-src/Chaos.cpp:3264-3451`), and only its unported champion editor gave one
  a `.CMP` of the utility disk. RISE's dialog has NEW FACE on whenever it opens, and a
  champion whose portrait is a cell of DM's graphic 26 is raised with the utility's
  redrawn face of them (`swapInNewFaces`, `src/engine/Chaos.ts`; `doc/SAVES.md` → "RISE
  makes a save of its own"). OLD FACE makes CSBWin's adventure, byte for byte
  (`tools/checks/rise.ts`).
- 🚫 **A saved game the utility cannot read is damaged, not the program's end.** On a
  `GAMEBLOCK1` that opens only with word 10, CSBWin stops in `NotImplemented(0x1868)`
  (`doc/CSBwin-src/Chaos.cpp:2966-2999`); the port refuses it with message 14. No known
  file has that form (`doc/PROVEN_FACTS.md` → "Only the word-29 form reads").
- 🚫 **A `mini.dat` with an Extended Features block makes no adventure.** CSBWin's
  `_TAG000fc4` writes the new adventure a fresh block when `mini.dat` opened with one
  (`doc/CSBwin-src/Chaos.cpp:2141-2200`). The port refuses such a file (`TAG000fc4`,
  `src/engine/Chaos.ts`; `tools/checks/new-adventure.ts`). `mini.dat` is CSB's own, as on
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
  `src/engine/dsa/ops/objects.ts`), so a curse costs 3 Luck at once on every champion and the
  object taken off gives them back. No save format changes: the Luck a save carries is
  the attribute as it stands. `tools/checks/dsa-objects.ts` checks it.
- 🚫 **Word sizes from the file.** Two of CSBWin's constants are the English words'
  sizes: `AttackNames[300]` in graphic `0x230` and the source widths `DisplayFoodWater`
  blits the food, water and poisoned labels with. The French 1.3 and German 1.2
  `graphics.dat` have longer words in both places, so `parseGraphic230` sizes the names from the graphic's
  length and `drawFoodWaterPanel` reads each label at its own width. Every other set gets
  CSBWin's numbers (`doc/PROVEN_FACTS.md` → "The French 1.3 `graphics.dat`: longer
  words").
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
- 🚫 **The intro and the end screen run on wall-clock time** through the page's
  animation clock (`Presenter.frames`), not on a VBL counter shared with the game loop. Nothing else
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
- 🚫 **The boot shows the Atari ST disk's FTL logo before the title**, which CSBWin
  never had: `SWOOSH.IMG`'s picture, palette script and sound
  (`src/renderer/intro/Swoosh.ts`, `doc/ATARI_ST_DISK_REFERENCE.md` → "The logo in the
  port"), the page's own asset (`src/assets/swoosh.img`). It is not an
  extra: the author wants it on every boot. The player's startup animations
  (`SettingsValues.startupAnimations`, on by default) turn it off together with the title
  animation from `graphics.dat`; the entrance is then the first screen.
- 🚫 **`?intro=0` skips the whole intro**: the logo, the title animation and the
  entrance. This is a developer affordance with no CSBWin counterpart, kept deliberately:
  most of the golden frames boot through it, and so does `tools/probe-ui.ts --boot`.
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
  that drew 0 would write files the store takes for those. `tools/checks/new-game.ts`
  checks it on a stream whose first pair gives 0. The same goes for an id a save of the
  data set already holds, about one pair of games in 16 million: the page draws the next
  pair once the new game is read (`GameSaves.newGameRead`, `src/engine/GameSaves.ts`),
  checked by `tools/checks/save-menu.ts` on a store that holds a pinned stream's first ids.
- 🚫 **A `CSBgraphics.dat` sound plays its WAV file's `data` chunk.** `ReadSound` takes the
  sample count from byte 40 and the samples from byte 44
  (`doc/CSBwin-src/Sound.cpp:1024-1033`), which are the `data` chunk's only after a
  16-byte `fmt ` chunk. Sound 705 (`coat`) of
  both files here has a 4-byte `fact` chunk there, so CSBWin plays its four bytes, a
  click at most; the port plays the `data` chunk after it, its 4574 samples, the count
  the `fact` chunk itself gives. Every other sound starts its `data` chunk at byte 36, and
  plays as in CSBWin, as does a section that is not a RIFF file (`doc/PROVEN_FACTS.md` →
  "`CSBgraphics.dat`'s sounds are WAV files"; `SoundQueue.readSound`,
  `tools/checks/custom-sounds.ts`).
- 🚫 **Audio sample rates**, a documented exception to faithfulness:
  `doc/PROVEN_FACTS.md` → "Audio sample rates".
- 🚫 **`dm-atari/graphics.dat` is not CSBWin's file.** It is CSBWin's with two items from
  the Atari ST 1.2 disk: the credits scroll, which CSBWin's corrupts, and the pressed
  crack switch, whose front view shows its button pushed in and whose `Byte4100[55]`
  keeps it low on the wall, as in the original. `dm-windows/` keeps
  CSBWin's file as it ships. `doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's
  with three items from the 1.2 disk"; `tools/checks/dm-atari-graphics.ts` builds and checks it.
- 🚫 **`dm-amiga/graphics.dat` is built, as `dm-atari`'s is.** It is `dm-atari`'s with the
  Amiga 2.2's credits, picture 396, objects' names and font in their place, `dm`'s tables
  written into items `0x22e` and `0x232` where CSBWin reads the Atari's, and the Amiga's
  sounds and a table item of the port's appended after item 562, where CSBWin reads
  nothing; its sounds 533-555 stay the Atari's, so CSBWin plays the folder.
  `doc/AMIGA_DISK_REFERENCE.md` → "The `dm-amiga` set's `graphics.dat`";
  `tools/checks/amiga-graphics.ts` builds and checks it.
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
- 🚫 **A decoration's position set past item `0x22e` is not drawn.** A floor decoration's
  and a door ornament's set is a byte read on past `Byte4110` and `Byte4122`, and reaches
  255; CSBWin reads the set's rectangles on through `d` (`CSBCode.cpp:3957`, `:4073`), and
  past the item, from decoration 99 on the floor and ornament 111 on a door in DM's
  `graphics.dat`, into its own variables. The port reads the rectangles to the item's end
  (`floorDecorationDescSets`, `doorOrnamentRectSets`, `src/data/tables/ObjectTables.ts`)
  and draws nothing past it: `doc/PROVEN_FACTS.md` → "Item `0x22e` is laid out exactly as
  `Data.h` declares its span". No dungeon here names a decoration past DM's tables.
- 🚫 **A record read through a slot `DeleteDBEntry` has freed.** Such an RN names no record,
  and CSBWin reads one anyway in two places. `MakeMoreRoomInDB` hands back the freed slot
  of the group or missile it threw out, and `FindEmptyDB<n>Entry` reads past the databases
  through it: `makeMoreRoomInDB` (`src/engine/MakeMoreRoomInDB.ts`) names the freed record
  anew, `RN(dbType, index)`, as the Atari original's RN still named it
  (`doc/PROVEN_FACTS.md` → "A full database throws one object out of the dungeon"). A
  missile whose own wall filter moved the party into it is deleted by that hit, and its
  encounter's tail calls `ProcessObjectFromMissile` on it again; the port's
  `processObjectFromMissile` finds no record and does nothing
  (`tools/checks/move-from-missile.ts`, section 3).
- 🚫 **An index CSBWin does not bound reads nobody.** `&CHAR@`, `&TALENTS@` and
  `&TALENTS!` take an index of 0x20000 or more with bit 16 clear as `d.CH16482 + charIdx`
  (`doc/CSBwin-src/DSA.cpp:4197`, `:4275`, `:4326`), a record over 100 MB past `d`;
  `&CHAR@` of a champion in the wings takes `d.PendingDamage[charIdx]` off their HP, bit
  16 and all, 128 KB past that array of four (`:4201`), and the port takes nothing; and
  `&EXPERIENCE+` reads the HP of a negative one from the `d.` variables before the array,
  then hands it to `AddToSkill` (`:4553`). The port reads zeros, leaves the talents and
  adds nothing (`src/engine/dsa/ops/characters.ts`). A slot from 0 to 3 that no
  champion fills is a different case, and is read as CSBWin reads it
  (`PartyState.vacantCharacters`). Two more reads past an array go the same way:
  `DSADBANK::GetText` takes a text index past 9 once a text is set
  (`doc/CSBwin-src/DSA.cpp:208-213`), and `PrintWithSubstitution`'s `@p` with no attack
  menu open names `d.CH16482[-1]` (`Graphics.cpp:1591`); the port reads "" for both
  (`DsaBank.getText`, `src/engine/PrintWithSubstitution.ts`). `&LOC2ABSCOORD` of a level
  that is not there and `&MULTIPLIER@` of a negative one read a level descriptor past
  the array (`DSA.cpp:324-325`, `:3985`): the port reads zeros. And `&VSET` with a count
  whose sum with `dst` or `src` wraps past 2^32 writes past the 100 variables
  (`:4863`, `:4882`): the port stops at the last (`vset`, `src/engine/dsa/ops/stack.ts`). `RemoveCharacter`,
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
  inventory's button"; `tools/checks/hint-oracle-button.ts`).
- 🚫 **A left click on a champion's bars opens the inventory.** DM opens one with the
  right button only: a portrait box's, `buttons17196`'s buttons 7-10, or anywhere below
  the portraits for the leader, `buttons17304`'s 83. A finger or a stylus has none. The
  right button's other uses need no stand-in: the thaw and the wake-up take either
  button (`buttons17832`, `buttons17796`), and an open inventory closes on the champion's
  name. In a portrait box, `buttons17196` gives the left button the name and the hands
  (12-15, x 0-41 of the box) and nothing on the health, stamina and mana bars. So a
  left click that no list takes, in a box, is searched as the box's right click
  (`searchMouseButtons`, `src/renderer/ui/Mouse.ts`), on every platform. Nothing is drawn.
  Asleep or frozen the primary list has no 7-10, and the bars stay dead.
  `tools/probe-frames.ts` checks that a click opens and closes an inventory.
- 🚫 **DONE on the Hint Oracle's title list closes it.** CSBWin's goes back to the load
  screen (`w_4 = 1`, `doc/CSBwin-src/Hint.cpp:7375-7388`), whose floppy prompts and save
  chooser only lead to a square, and the port's Oracle has the party's
  (`HintOracleScreen.run`, `src/renderer/intro/HintOracle.ts`).
- 🚫 **An image whose header asks for more than `maxSize` decodes to the lines that fit.**
  `ExpandGraphic` caps the destination at `maxSize` bytes, 999999 by default
  (`doc/CSBwin-src/CSBCode.cpp:11031`, `CSB.h:4003`), but its end test is
  `A1 == endOfDestLine` (`:11034`, `:11077`, `:11160`), and `A1` moves in 8-byte groups,
  so a cap that is not a whole number of groups is never met: the decode writes on past
  the buffer, through the heap, until something breaks. Sphenx's Theron's Quest
  `graphics.dat` has such an image, graphic 5 with a PC header (320x200 little-endian,
  read as 16385x51200), and CSBWin shows its entrance scroll as an error and quits. The
  port's `decodeIMG` stops at the whole lines `EXPAND_GRAPHIC_MAX_SIZE` holds
  (`src/core/imageDecoder.ts`), 121 of them there, and returns that height. No real image
  comes near the cap. `tools/checks/image-codec.ts` checks it.
- 🚫 **A portrait's size is tested without CSBWin's wrap.** `ImportBitmap`'s
  `size = (width+1)/2 * height` and its test `fileSize < minSize + size` are `ui32`s
  (`doc/CSBwin-src/Bitmaps.cpp:251-252`, `:356-372`), so a width and height whose product
  wraps, 131071 by 65536 giving 0, pass it, and the pixels are read past the section,
  into the heap. The port tests the exact size, and refuses such a portrait
  (`CSBGraphicsLoader.importBitmap`, `src/data/CSBGraphicsLoader.ts`); every portrait here is
  582 bytes. `tools/checks/damaged-counts.ts` checks it.
- 🚫 **A save that names what its world does not hold is refused.** `LoadGame` takes the
  party's level, x and y, `d.NumCharacter`, `d.HandChar`, `d.MagicCaster`, the object in
  hand and the timer queue from the file unchecked, and plays a value past what it names
  on into memory past the level's cells, the four `CHARDESC`s, the object index or the
  timer table (`doc/PROVEN_FACTS.md` → "A save's party, hand and timers are read without a
  check against its world"). The port refuses such a save before its read builds
  anything, a party on a level the dungeon has not, at a square past the level, of more
  than four champions, a hand or a caster outside the party, an object in hand that names
  no record, or a timer past the table (`validateCsbwinWorld`,
  `src/engine/CsbwinSaveGame.ts`), and the running game plays on. No save CSBWin or the
  port writes holds such a value. `tools/checks/damaged-read.ts` checks each case.
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - Names like `tag0207cc`, `TAG02076e` and `_FusionSequence` are CSBWin's, kept wherever a
    module gathers or splits the functions (`src/engine/dsa/`): the structure need no longer follow
    CSBWin's files, but a ported function stays greppable against its C++.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
