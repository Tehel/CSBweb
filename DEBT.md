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
code needs before them: a base solid enough to build them on. The page redesign has
begun: tier U is its first part, and `E15` the next.

**Conflux 3.5** (`static/gamefiles/conflux-3.5-b8/`) is the third dungeon, a data set
(`conflux-3.5`) whose first ticks play (`tools/watch-conflux-start.ts`) and whose start is a
golden frame. What waits on the author for it is C150. Its `dungeon.dat` is enciphered, and reads whole
(`doc/PROVEN_FACTS.md` → "The "simple" encipherment is `RC4.cpp`'s own cipher"). Its
skins are drawn (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Skins in the data sets"). Every DSA operation CSBWin has is ported, not only Conflux's share
(`tools/dump-dsa-census.ts`), and a dungeon with DSAs saves (`tools/dump-dsa-save.ts`).

**First, at the author's request: P — players' own data sets.** A player adds a dungeon
from their own files to the welcome page, plays it, edits it and deletes it; what is left
is publishing it, and moderating what is published (P9, P8). They are not CSBWin features but the page's, and come before every other
tier.

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
4. **G — Unported CSBWin features the default dungeon reaches**, in the index's order.
5. **F — Verification debt** is independent of the rest. Interleave it anywhere.

**Postponed (⏸️) until the default dungeon is validated.** These are not taken in order,
and no session picks one up unless the author names it:

- **A save of a dungeon the port does not know** (G22).
- **What only another dungeon reaches** of CSBWin 20230608's own: 3D2D1D's vertical moves
  and gravity (G30), which its Extended Features block turns on.
- **CSBWin's debugging features** that are not part of the game: the ASCII dump, and the
  DSA trace, whose flags `WriteDSAs` follows the DSAs with, an `EDBT_DSAtraces` record
  (`DSAIndex.WriteTracing()`, `doc/CSBwin-src/SaveGame.cpp:1014-1018`) that a read takes
  back (`DSAINDEX::ReadTracing`, `DSA.cpp:5554-5577`). The port writes none.
- **Comparing frames against CSBWin's own screenshots**: staging the same scene in
  CSBWin, without cheats, costs more than it proves, and the golden frames and the render
  probe already catch any pixel that changes unintentionally. When it is taken, the
  canvas's colours go with it: an Atari intensity times 36, not CSBWin's RGB555 (H).
- **X — Extras**: gameplay features CSBWin does not have, wanted by the author once the
  faithful game is complete.

A **Chaos Strikes Back** feature is *not* postponed: CSB is the next dungeon to try once the
default one is satisfying, and DM is a subset of it. A feature CSB needs stays in the
active list, even if DM never reaches it.

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
   byte-identical before and after (only `dump-save-menu`, by one byte, and
   `dump-savegame`, by its payload's size, vary on their own: both carry the save's
   wall-clock date; `dump-new-game` and `dump-game-events`, by the random game ids
   they print; and `dump-monster-design-options`, whose unseeded games draw their seed
   from `Math.random`, so it compares only with `Math.random` pinned, through
   `npx tsx --import`), and the author's runtime saves hash the same after load and
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
| P9 | Moderators, and the sets only they see | S | ⏳ |
| P8 | Publishing a local set, and moderating it | L | ⏳ after P9 |
| E15 | The page shell | L | ⚠️ step 6 of 6 next |
| E39 | The About and Credits pages | M | ⏳ to design with the author |
| F20 | A tool is run without its types checked | S | ⏳ |
| W1 | An aborted download leaks a file descriptor | S | ⏳ |
| R1 | A game read in play leaves the screen on the old world | M | ⏳ |
| R3 | After a fatal error the page still saves | S | ⏳ |
| R4 | F9 reads over a champion being chosen, and over a script that starts during its read | S | ⏳ |
| R5 | Another tab holds the store: the new build hangs at ENTER | S | ⏳ |
| W2 | `api/stats` is computed whole at every request | S | ⏳ |
| W3 | `api/event` takes another site's posts, and any name | S | ⏳ |
| R6 | A damaged file's counts size allocations and loops | M | ⏳ |
| R7 | An index from a custom data set can throw | S | ⏳ |
| R8 | An optional feature's failure ends the game, or the session | S | ⏳ |
| R10 | Pointer, touch and WebGL | S | ⏳ |
| R11 | Right-click closes the save menu while it saves or loads | S | ⏳ |
| W4 | The events table grows without bound | S | ⏳ |
| W5 | The statistics are pseudonymous, not anonymous | S | ⏳ |
| W6 | Security headers | S | ⏳ |
| W7 | The container, the deploy and the Node version | S | ⏳ |
| R12 | Listing the saves reads every save's bytes | M | ⏳ |
| D17 | The screen keeps the party it last drew | S | ⏳ |
| E23 | One game read, whole or not at all | L | ⏳ |
| D18 | The interface's `d.` lives in the screen, and composing the screen changes the world | L | ⏳ |
| D19 | `RuntimeSaveState` is neither strict nor a snapshot | M | ⏳ |
| E34 | Dead code and duplicated types | S | ⏳ |
| E24 | Two import cycles, and pure helpers in the systems | S | ⏳ |
| E35 | Comments and documents that are stale, wrong, or tell the past | M | ⏳ |
| E36 | Type escape hatches that check nothing | M | ⏳ |
| E25 | One helper for each rule, where copies drift | M | ⏳ after C170, C171 |
| E26 | Systems named after CSBWin's files, not what they do | M | ⏳ |
| D20 | Three record-size tables and two image layouts | S | ⏳ |
| D21 | A save has nine shapes | L | ⏳ |
| E27 | `DsaSystem.ts` is one 5,000-line class | L | ⏳ after E24 |
| E28 | The bytecode interpreter decodes through switches and maps built per call | M | ⏳ |
| E29 | `GameScreen` is the canvas, the compose order, the palettes and a façade | L | ⏳ |
| E31 | Late wiring with silent defaults, and long parameter lists | M | ⏳ |
| E32 | Four ways to read bytes, and eight graphics caches | M | ⏳ |
| E33 | What a frame costs | S | ⏳ |
| E30 | One presenter and one input router | M | ⏳ |
| E22 | The screen's ratio, and a fractional fill | M | ⏳ after E15 |
| C177 | An Atari-era save loads with its possessions, timers and hand unconverted | M | ⏳ |
| C178 | No save keeps the dungeon's game information | S | ⏳ |
| C171 | The Firestaff does not soften a monster's blow, and three mastery calls ignore sleep | S | ⏳ |
| C168 | A monster north-west of the party never prefers west | S | ⏳ |
| C169 | A monster's `timePerMove / 2` is not an integer division | S | ⏳ |
| C170 | A blow at the party skips a living champion who shares a dead one's corner | S | ⏳ |
| C172 | A dead monster's remains are linked onto the square, not moved there | S | ⏳ |
| C173 | The DSA's `&ADD` and `&DEL` on a square bypass `MoveObject` | M | ⏳ |
| C174 | DSA copies that are not whole | S | ⏳ |
| C175 | The DSA's integer widths | S | ⏳ |
| C176 | The DSA goes on where CSBWin stops | S | ⏳ |
| C179 | A thrown object drawn as its floor picture is offset and never mirrored | S | ⏳ |
| C180 | `AdjustSkills`' widths, and a gain of 0 | S | ⏳ |
| C181 | What `d.Initialize()` zeroes survives a restart | S | ⏳ |
| F15 | Tools that read the wall clock, and a runner with no timeout | S | ⏳ |
| F16 | A tool can pass having checked less than it says | S | ⏳ |
| F18 | One `tsconfig` for the browser, the tools and the server | S | ⏳ |
| F19 | The tools' screen is wired by hand, and has drifted | S | ⏳ with E29 |
| F17 | The frame pipeline and the runner are untyped | M | ⏳ |
| G29 | Recording a game and playing it back | — | ⏸️ |
| C150 | Conflux's "Jitter" DSA can pass an overlay jitter, where CSBWin's source stops | S | ⏸️ waits on the author |
| G21 | `Translation.txt`: the messages the executable prints, translated | — | ⏸️ |
| G22 | An unknown dungeon played from its save | — | ⏸️ |
| G30 | 3D2D1D's vertical moves and gravity | L | ⏸️ |
| X9 | Thrown weapons' tags kept across a save | M | ⏸️ |
| X10 | The cells the party has seen, kept across a save for an automap | M | ⏸️ |
| H | Deliberate divergences | — | 🚫 |

The rows above G29 are the active list. `E39` waits for the author's design, and `E22`
for E15: a session that reaches either first asks the author, and takes the next active
row meanwhile. A
new row takes its tier's place above it. The F rows are independent of the rest
("Priority", point 5), so they can be taken anywhere.
The ⏸️ rows are postponed (see "Priority") and are never "the first row".

Size: **S** well under a session · **M** about one session · **L** several sessions.

Next free IDs: C182 · D22 · E40 · F21 · G31 · P10 · R15 · U11 · W8 · X11. An ID recorded and paid in one commit has no
entry here, only its commit, so take the next ID from this line and move it on.

---

## P — Players' own data sets

At the author's request, from the forum: a player adds a dungeon from their own files, plays
it like any other, and later offers it to the site. It mirrors CSBWin, which plays whatever
its `directory=` holds (`src/data/DataSets.ts`), so the engine does not change and nothing
goes in H. Two phases: a set kept in the player's browser, which stands, and P8, which publishes it.

What stands: a local set is a record of the store's `dataSets` object store
(`BrowserDataSetStore`, `src/data/saves/`), `LocalDataSetRecord` in
`src/data/LocalDataSets.ts`. A `?dungeon=local:<id>` plays it (`chooseDataSet`,
`src/main.ts`): its `DataSet` follows from its files (`localDataSet`), and the boot reads
them by name through `recordFiles`, its base set's folder giving a `graphics.dat` it does
not have, as a manifest set's are read through `folderFiles` (`src/data/DataSetFiles.ts`).
It sends no statistics. It refuses no imported save: one whose walls are not all its
record's `dungeonSignature` is asked about and stored on CONFIRM (`DataSet.dungeonSignature`,
`checkDungeon`, `doc/SAVES.md` → "A player's own set refuses no save"), so that a set
being built keeps its saves as its walls move. `tools/dump-local-data-set.ts` plays such
records against their manifest sets. The welcome page (`src/ui/welcomePage.ts`) shows the local sets beside the
manifest's, under the same order, a record's thumbnail as its tile's picture, and counts
their saves; its last tile, "+ Add my own", opens the form that adds a set
(`src/ui/addDataSetForm.ts`), a modal dialog on one screen. On its left, what the player
gives: the name, the id (made from the name until the player writes one), a description,
the authors, the reincarnation rule (DM's at first), DM's or CSB's graphics for a set without a
`graphics.dat`, and one area that takes the files, dropped or picked, each going where its
name says. On its right, the checklist of the name, the id and the six files, crossed or
checked, a removable file on its row, and on the thumbnail's, while it has none, "Generate
from data", which draws the site's sets' thumbnail, the title's last frame
(`src/renderer/intro/TitleThumbnail.ts`, `tools/gen-thumbnails.ts`'s too), from the set's
`graphics.dat` or its base set's; under it, what the dungeon holds once its
`dungeon.dat` reads (`dungeonCensus`, `src/engine/DungeonCensus.ts`, whose DSA half
`tools/dump-dsa-census.ts` checks); and CANCEL and CONFIRM. `checkLocalDataSet` runs at
every change with the boot's own readers, each file read, parsed and hashed once and `src/engine/FileSignatures.ts`'s rules, and
makes the record CONFIRM stores; the page then shows the set selected. A pen on a local
set's picture reopens the form on its record: its id fixed, since its saves are filed
under it, and its `dungeon.dat` replaceable but not removable; the record CONFIRM writes
keeps when it was added, and a new `dungeon.dat` gives it a new signature, which the
saves already stored do not need. The form's DELETE asks first, counting the saves that
go with the set and pointing to the save menu's EXPORT, then removes the record and
those saves in one transaction (`BrowserDataSetStore.remove`).
`tools/dump-local-data-set.ts` proves the check, the record and the census,
`tools/probe-frames.mjs` drives the form, adding, editing and deleting a set.

The server lists the site's sets from its store (`server/dataSets.ts`, `doc/DEPLOYMENT.md`
→ "The game files and the manifest"): each row approved or pending, with its owner's
`playerId` or none for the author's, `api/data-sets` answering each player the sets they
may see. Its `gamefiles/` is mounted read-write, and `server/backup.ts` copies the folders
of the sets with an owner beside the store's snapshots.

The `<id>` is a folder's name (`LOCAL_ID_PATTERN`: lowercase letters, digits, `.`, `-` and
`_`, at most 40), since P8 makes it the set's folder on the server. No shipped dungeon
names its `graphics.dat` or `CSBgraphics.dat`, nor expects a `CSBgraphics.dat`, so the
signature checks are proven on dungeons the tool builds.

Decisions taken with the author, for every row:

- **A local set's id is `local:<id>`**, the `<id>` chosen by the player and unique among
  their local sets. No manifest id has the prefix, so a local set never shadows a site set.
  Publishing (P8) drops the prefix and checks that the id is unique on the server.
- **No `graphics.dat` given: the player chooses DM's or CSB's.** The set then reads that
  set's file (`dm-atari` or `csb`) from its folder.
- **No statistics for a local set**: `GameEvents` sends nothing. The server's
  `events.ts` takes only manifest ids anyway.
- **The `playerId` is a secret** (`src/ui/gameEvents.ts`). Ownership on the server rests on
  it alone, so the server never returns one, writes one in its logs or takes one in a URL's
  query. A lost id is handled by hand on the forum for now.

A custom dungeon reaches what the shipped ones do not, so R7 and R8 matter more now.

### P9 ⏳ Moderators, and the sets only they see

S, before P8, whose endpoint it gates. Decided with the author:

- **Moderators, not one author.** `AUTHOR_PLAYER_ID` (`server/server.ts`, `server/app.ts`)
  becomes `MODERATOR_PLAYER_IDS`, a comma-separated list of `playerId`s, so that the
  burden can be shared: spaces around a comma are ignored, unset or empty is no moderator,
  and an entry that is not a `playerId` stops the start. `DataSetViewer.author`
  (`server/dataSets.ts`) becomes `moderator`. A set with no owner (`owner` NULL, the
  manifest's, uploaded by hand) is the site's, not a moderator's.
- **A moderator sees every set in the grid**, hidden and pending included. The answer to
  `api/data-sets` says `"moderator": true` at its top level, to a moderator only, which
  `parseManifest` reads into the manifest, and `chooserSets` then keeps the hidden sets.
  It tells the asker nothing they do not hold: their own id is a moderator's.
- **A tile's name says its set's state**: cyan for a local set (`--p4`, as now), red for a
  pending one (needs attention: the UI palette's entry 8, `0700`, `#fc0000`), purple for a
  hidden one, white otherwise (`--p15`). A pending set is red to its owner too, and red
  wins over purple. The UI palette (graphics.dat palette 552, entry 0) holds no purple:
  its colours are greys, browns, cyan, two greens, red, gold, flesh, yellow and blue
  (`0007`, unreadable on black). Purple is therefore the one colour of the welcome page
  outside it, said so in `welcomePage.css`: an Atari colour of cyan's intensity, `0606`
  (`#d800d8`).
- Evidence: `tools/dump-server.ts` (a list of two, each seeing every set and
  `"moderator": true`, nobody else either; a malformed entry refusing the start),
  `tools/dump-data-sets.ts` (the parser's flag, `chooserSets` with and without it), and
  a `tools/probe-frames.mjs` block for the four colours. `doc/DEPLOYMENT.md` says the
  `.env`'s new variable.

### P8 ⏳ Publishing a local set, and moderating it

L, after P9, in five steps (below); none is taken yet.

**The lifecycle.** A set is in one of four states, which its tile's name says (P9):

| State | Kept | Seen by | Name |
| --- | --- | --- | --- |
| local | the player's browser, `local:<id>` (stands) | that player | cyan |
| pending | the server: its folder `gamefiles/<id>/`, its row `pending`, owned by its uploader | its owner, the moderators | red |
| approved | its row `approved` | everyone | white |
| hidden | an approved row with `hidden` set | the moderators in the grid; anyone by `?dungeon=<id>` and CONTINUE | purple |

The manifest's sets start approved, with no owner, and hidden where it says so.

**The transitions needed**, each from a tile, as the pen is a local set's (it stays at the
picture's top right, the others along the top edge beside it):

| Transition | Who | Where | What the server does |
| --- | --- | --- | --- |
| local → pending: **publish** | the set's player | PUBLISH, in the form the pen opens | the checks below, the folder written whole, then the row |
| pending → approved: **approve** | a moderator | a tick on a pending tile | `status` set to `approved` |
| pending → gone: **reject**, or **withdraw** | a moderator, or the set's owner | a cross on a pending tile | the row deleted, then its folder |
| approved ⇄ hidden: **hide**, **show** | a moderator | the eye on an approved tile, open or shut | `hidden` toggled |

Not needed, and left to a moderator's hands on the VPS (`doc/DEPLOYMENT.md` will say how):

- **Deleting an approved set.** Hiding it is the answer to a complaint, since its players
  keep their saves and their way back; a deletion makes their saves count for nothing.
- **Changing a published set's files.** A folder never changes once written, which the
  backup relies on (`server/backup.ts`); a new version is published as a new id.
- **Taking an approval back.** Hiding does that job without losing anything.
- **The order of the sets and the default set**, a row's `position` and
  `data_set_defaults`.

**The endpoint**: `POST api/data-sets/<id>`, a JSON body `{"action": "approve" | "reject" |
"hide" | "show"}`, the `X-Player-Id` header naming the asker. 403 unless the asker is a
moderator, or the owner rejecting their own pending set; 404 for an id not in the table;
409 for an action the set's state does not take (approve an approved set, hide a pending
one). The page then asks `api/data-sets` again and redraws the grid. Publishing is its
own route, which takes the files.

**Publishing** (PUBLISH sends the record's files and fields with the `playerId`). The server:

- drops `local:` and refuses an id already in the table;
- refuses an id whose folder `gamefiles/<id>/` already exists (`swoosh/`, or a folder no
  row names) or that starts with `.` (the server serves no such segment);
- caps each file's size and each player's rate;
- parses `dungeon.dat` with the page's own reader;
- writes the folder under `gamefiles/<id>/` whole, then the row as pending, owned by the
  sender, and never changes the folder after: `backup.ts` copies each owned set's folder
  once, the first night its row is in a snapshot (`doc/DEPLOYMENT.md` → "Backups").

**PUBLISH leaves the local record as it is** (decided with the author): a cyan tile
beside the red one, its saves still filed under `local:<id>`, and the player can go on
building it. Nothing is moved or deleted. Since its id is fixed in the form and taken on
the server, a second PUBLISH of it is refused: a new version is a new local set, under a
new id. Deleting the record once its set is approved, its saves moved to `<id>`, may
follow as an item of its own.

**The steps**, each a commit with its evidence:

1. **The page's reader on the server.** `checkLocalDataSet` (`src/data/LocalDataSets.ts`)
   and the loaders under it import without extensions and use enums, which Node's type
   stripping cannot run, and the image copies only `src/data/DataSets.ts`. The build makes
   the check a Node module (a second Vite build, SSR, of one entry, into `dist/server/`),
   the image copies it, and `server.ts` hands it to the API in `ApiOptions` beside
   `dataSets`, so a tool passes the source's function instead. Evidence:
   `tools/dump-server.ts` checks a set through it, `tools/check-image.sh` that the image
   runs it.
2. **The publish route.** `POST api/data-sets`, a `multipart/form-data` body (Node's own
   `Request.formData()`): the record's fields and files, and `X-Player-Id`. The rules
   above, in that order, then: the flags follow from the files as `localDataSet`'s do;
   a set without a `graphics.dat` has its base set's copied into its folder, so the folder
   is a CSBWin directory like any other and the manifest needs no new field; the thumbnail,
   which the page sends as a PNG, is `<id>-thumbnail.png` (`thumbnailPath`); the folder is
   written as `gamefiles/.<id>.partial/` and renamed whole; the row goes last in `position`,
   with two new columns for the description and the authors. The caps: 16 MiB a file
   (Conflux's `CSBgraphics.dat` is 12 MB) and 32 MiB a request, and a few publishes per
   address an hour (`RateLimit`, `server/events.ts`); `doc/DEPLOYMENT.md` gives nginx's
   `client_max_body_size` for the route. Evidence: `tools/dump-server.ts`, a publish
   accepted (the folder whole, the row pending and owned, seen by its owner and the
   moderators only) and each refusal answered with nothing written.
3. **PUBLISH in the form.** The pen's form (`src/ui/addDataSetForm.ts`) has PUBLISH,
   enabled while the record is stored as the form shows it; it sends the record with the
   `playerId` (`src/ui/gameEvents.ts`), says the server's refusal in the form, and on
   success asks `api/data-sets` again, so the grid shows the red tile beside the cyan one.
   The dev server (`vite.config.mts`) answers the route as `server/app.ts` does, into a
   scratch folder. Evidence: a `tools/probe-frames.mjs` block, a publish and a refusal.
4. **The moderation endpoint**, `POST api/data-sets/<id>`, as above: reject and withdraw
   delete the row, then the folder (the backup keeps its copy). `doc/DEPLOYMENT.md` says
   what is left to a moderator's hands. Evidence: `tools/dump-server.ts`, every action
   and every 403, 404 and 409.
5. **The tile's tick, cross and eye** (`src/ui/welcomePage.ts`), each shown only where its
   transition is allowed to the viewer, then the grid redrawn from `api/data-sets`.
   Evidence: a `tools/probe-frames.mjs` block.
---

## U — The interface in the canvas

The page holds nothing beside the canvas (`index.html`): what it offered moved into it,
as dialogs drawn in the game's 320x200 buffer like the save menu: the settings, the map,
the champion table. The data set is chosen on E15's welcome page, which opens `?dungeon=`. The
look is the save menu's, cut from graphic 0 and drawn in the UI palette's sixteen
colours, and the design canvas "DMweb page flow"
(`https://claude.ai/artifact/DiNNPrFfCkphD9LRNBckSG`) shows it: artboard 10, the widget
kit, and artboard 5, the settings dialog. Reading the canvas's URL gives only its shell
page; each artboard is a published file of it, `project/Kit.dc.html` and
`project/Settings.dc.html` among them (`.claude/memory/design-canvas-files.md`). The kit is the look to follow; the screens,
artboard 5 among them, are brainstorm material, not final designs. At 320x200 there is
one font size, so a setting is one line, and its description goes in a help line at the
dialog's foot. Being in the buffer, the dialogs are under the CRT effect and in
fullscreen, and the golden frames see them.

The settings dialog (`src/renderer/ui/SettingsDialog.ts`) is the first: Esc or a double
click on the message area opens it. Its GAME, DISPLAY and SOUND tabs set the player's
settings, and KEYS binds the keys (`src/renderer/ui/SettingsKeys.ts`). Its EXIT, which
leaves for E15's welcome page, is drawn inert until then; once live, EXIT asks first in
`_DoMenu`'s two-option menu, as what has not been saved is lost. On GAME and DISPLAY each
setting is a button holding its name, two a line; the dialog has five lines
(`SETTING_LINES`), and GAME takes three.

The map dialog (`src/renderer/ui/MapDialog.ts`) is the second: with GAME's MAP VIEW on,
the MAP key, which no preset binds, or a long press on the message area opens it. It
draws the party's level whole; a page opened with `?dev` moves the party by a click on a
square.

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

### R1 ⏳ A game read in play leaves the screen on the old world

A read replaces `ctx.party.state` (`Party.setState`, `src/engine/Party.ts:118-126`) and the
world, and tells the screen nothing. `ui.partyState` (`src/renderer/ui/UIState.ts:73`), the
open chest (`ui.openChestId`, `ui.openChestContents`), the attack menu
(`ui.possibleAttackTypes`) and the Reincarnate screen (`ui.reincarnate`) stay the old
world's until the next `refreshScreen`, and what runs before it acts on them:

- **F9 with a chest open loses an object.** The next compose's `syncOpenChest(ui, null)`
  (`src/renderer/GameScreen.ts:650-653`) repacks the old world's open contents into the
  loaded world's chest (`repackOpenChest`, `src/renderer/ui/Inventory.ts:376-399`). An
  object taken from the chest into the hand before F9 is then in no chain of the loaded
  world; one put into it is linked twice, which cuts the chain it lies in. F9 is taken
  with an inventory open (`GameInput.keyDown`, `src/renderer/GameInput.ts:325-334`). The
  disk menu's LOAD loses nothing: opening the menu runs `TAG02076e`, which repacks first.
- **The disk menu's LOAD runs `TAG0207cc` on the old party.** `restoreChosenSave` reads,
  then `closeSaveMenu` calls `tag0207cc(ui)` (`src/renderer/ui/SaveMenu.ts:1099-1112`,
  `:474-481`; `src/renderer/ui/Mouse.ts:413`), which opens the old party's inventory
  again and leaves `ctx.loop.videoMode` at `'VM_INVENTORY'` while the loaded party has
  none open (`selectedCharacterIndex: -1`, `src/engine/CsbwinSaveGame.ts:111`). Nothing
  puts it back until an inventory is toggled (`Game.ts:550` resets only the other modes),
  so `GameScreen.isAdventureVideoMode` is false and a dungeon's overlay is not drawn
  (Conflux). CSBWin's `TAG0207cc` runs on the world just read.
- **A Reincarnate screen or an attack menu up at F9** acts on the loaded party's champion
  of the same index (R4).

Paying it: every read in play tells the screen (one `GameHost` notice from
`applySaveBytes`), which drops the chest view without a repack, closes the attack menu,
the Reincarnate screen, the eye and the mouth, and sets `ui.partyState` before `TAG0207cc`
runs. A `tools/` check: a chest open, an object taken out, F9; and a LOAD from an open
inventory. D17 and D18 then remove the cause, two owners of the same state.

### R3 ⏳ After a fatal error the page still saves

`reportError` (`src/main.ts:677`) stops the game and puts up the message, and nothing
else. `GameInput` still takes the keys (its `ended()` is `mainLoopHasReturned()`, which
`stop` does not set, `src/renderer/GameInput.ts:74-76`), `quickSave` does not ask whether
the game runs (`src/engine/GameSaves.ts:510-531`). So F5 after a VBL that threw writes the
half-updated world over the playthrough's quick save, the one F9 reads after the reload the
message asks for.

Paying it: a fatal error leaves the page dead: one flag that `GameInput` and the three save
paths check.

### R4 ⏳ F9 reads over a champion being chosen, and over a script that starts during its read

F5 and F9 go through `GameInput.keyDown`, so the save menu, the Reincarnate screen and the
Hint Oracle take them first. Past them, `quickLoad` refuses only while a script runs
(`GameSaves.ts:569-574`), not while a champion is being chosen
(`potentialChampionIndex >= 0`, a mirror's champion shown before RESURRECT or
REINCARNATE), as `quickSave` does.

`quickLoad` also checks for a script before its two awaits (`list`, `open`) and not after,
so a script that starts while IndexedDB answers runs on into the loaded world.

Paying it: F9 refused while a champion is chosen; the script checked again after the
awaits.

### R5 ⏳ Another tab holds the store: the new build hangs at ENTER

`openSaveDatabase` (`src/data/saves/idb.ts:64-87`) sets no `onblocked`, and no connection
closes on `versionchange`. An open tab of the build before a `DB_VERSION` bump keeps its
connection, so a new tab's open never settles: ENTER awaits `readNewGame`, which awaits
`saves.newGameRead()` and `list()` (`src/main.ts:126-134`), and the game never starts; F5,
F9 and the disk menu wait for ever. Two more gaps in the store:

- nothing asks `navigator.storage.persist()`, so the browser may evict the only copy of
  the player's saves;
- `markUsed` reads and writes a row in two transactions
  (`src/data/saves/BrowserSaveStore.ts:157-161`), so two tabs can write a stale row back.

Paying it: close on `versionchange`; on `blocked`, a message asking to close the other
tabs; `persist()` at the first save; `markUsed` in one `readwrite` transaction.

### R6 ⏳ A damaged file's counts size allocations and loops

A count read from a file sizes an array or bounds a loop before anything checks it:

- **A dropped save can crash the tab.** `readDsa` sizes `states` from the file's
  `numStates` (`src/data/CsbwinExtendedFeatures.ts:313-317`), and the DSA section's
  checksum is compared only after every DSA is parsed. `readsGameBlock1`, the first thing
  an import runs, reaches it: a `csbgame7.dat` whose header checksum holds and whose
  `numStates` is 400 million is a V8 out-of-memory, and the tab dies. CSBWin's `DSA::Read`
  fails its allocation and dies cleanly (`doc/CSBwin-src/DSA.cpp:5638-5671`). The writer
  has the same `Array.from` (`:411`).
- **The same in the game files' readers**: `ExpandData`'s `new Uint8Array(dstSize)`
  (`src/core/compression.ts:313`), `CSBGraphicsLoader.readSection`'s `uncompressedSize`,
  `importBitmap`'s size test through `Math.imul(...) >>> 0`, which wraps, `SNDexpand`'s
  repeat count, and the LZW and `OvlDecode` chains, which loop for ever on a cyclic
  dictionary.
- **A skin program can hang the tab.** The bytecode interpreter's `for (;;)`
  (`src/renderer/bytecode/BytecodeInterpreter.ts:400`) has no step limit, so a `Jump` to
  itself in a `CSBgraphics.dat` program never returns, and no error reaches the fatal
  screen.

Paying it: a bound on every count that sizes something (a DSA's states at most 0xFFFF, a
size at most the file's or a sane maximum), a cycle guard in the dictionary decoders, a
step budget in the interpreter that ends in `die`. A tool feeds each reader a file with the
count set absurdly and checks that it throws.

### R7 ⏳ An index from a custom data set can throw

The shipped data sets stay in range; a custom one need not (G22):

- **Door ornaments**: `this.objectTables.doorOrnamentRectSetIndex[decoration]`
  (`src/renderer/ViewportRenderer.ts:275`) reads a 12-entry table unchecked, and
  `tables.doorOrnamentRectSets[set][nearness]` (`src/renderer/bytecode/DrawDoor.ts:127`,
  `:139`) four sets without `?.`, where the floor decorations' path guards
  (`rectSet?.[relativeCell]`). A door TOC entry of 12 or more, or a `Byte4122` value of 4
  or more, throws in the draw and ends the game.
- **The blitter clamps where it should clip.** `normalizeRectInclusive`
  (`src/renderer/csbwin/CanvasBlitter.ts:188-203`) moves `x1`/`y1` without moving
  `srcX`/`srcY`, and clamps a rectangle wholly off the right to `width - 1`: one partly off
  the left draws the wrong columns, one wholly off the right a one-pixel sliver. Each
  caller clips by hand, each its own way (`drawSingleObject` the low side only,
  `drawMonsterAt`'s `x1 === 223`, `DrawClouds`). Its comment says `srcWidth` limits the
  copy (`:214`); the body never reads it.
- **`DsaSystem`'s `!` on record lookups**: `getCreatureRecord(id)!` (`:3484`, `:3507`,
  `:3535`), `get{Weapon,Clothing,Misc}Record(obj)!` (`:3705-3707`), `getTextRecord(rn)!`
  (`:4078`). An index map naming a record past its database throws, where the sibling
  paths check (`findMonsterSource`).

Paying it: the guards; a clipping `tag0088b2Index`, its callers' own clipping dropped,
with `npm test -- --frames`.

### R8 ⏳ An optional feature's failure ends the game, or the session

- **The Hint Oracle** runs with `.catch(reportError)` (`src/main.ts:379`), so any error in
  it ends the game with whatever was not saved. `readHintOracle` throws for a world whose
  `hintKey` does not decipher `hcsb.hct`, such as an imported save of a modified CSB.
- **RISE's NEW FACE**: `utilityPortraits ??=` caches a promise that rejects when
  `arrayBuffer()` or the parse fails (`src/main.ts:151-158`), and `refreshSaveMenu`'s
  `await ui.onHasNewFaces()` then throws into the catch that empties the list
  (`src/renderer/ui/SaveMenu.ts:504-509`): RISE lists nothing until a reload.

Paying it: the Oracle closes on its own error with a line in the message area, and
`reportError` is kept for `Die`; the faces' promise settles to `null` on any failure.

### R10 ⏳ Pointer, touch and WebGL

- **Touch screens likely stay silent.** Audio is unlocked on the canvas's first
  `pointerdown`, once (`src/main.ts:166-178`), which is a user activation for a mouse and
  not for a touch: `resume()` fails, the listener is gone, and only the settings'
  SOUND brings the sound back.
- **A lost WebGL context keeps the curve.** On `webglcontextlost` the tube is hidden but
  `curvedCanvas` stays set (`src/lib/crt.ts:227-241`), so `canvasPoint` warps clicks over a
  flat picture, about 3 pixels near the edges.

Paying it: the unlock on `pointerup`, `click` and `touchend`, its listeners removed once
the context runs; the curve cleared with the context.

### R11 ⏳ Right-click closes the save menu while it saves or loads

`saveMenuClick` closes the menu on a right button (`src/renderer/ui/SaveMenu.ts:854-858`)
before it looks at `busy` (`:859`). The clock starts again and `TAG0207cc` runs while
`store.write` is pending; then `saveWritten` (`GameSaves.ts:288-312`) runs its monster
re-attach and `SmartDiscard` on a world that has moved on, against "the game played on
after a save is the one a load of it gives back". A LOAD that answers after the menu is
opened again restores into the new menu.

Paying it: a right-click while `busy` does nothing.

### R12 ⏳ Listing the saves reads every save's bytes

`BrowserSaveStore.list` is a `getAll` over whole rows, files included, and every F5,
Sleepsave, menu save, F9, import and new game lists. A Conflux save is about 0.6 MB, and no
row is ever deleted (the dialog has no delete). An import also parses its file three times,
and an enciphered save is deciphered twice (`loadCsbwinWorld` again after
`loadSaveGameState`).

Paying it: the rows' fields and their files in two object stores, which bumps `DB_VERSION`.
The deciphered data handed on by `loadSaveGameState`.

---

## W — The public server

`server/`, the page's host at `https://csbweb.looten.net/` (`doc/DEPLOYMENT.md`), is on the
open internet behind the VPS's nginx. Its weak point is availability: what an anonymous
client can make it hold, compute or keep. What holds already: paths (`..`, `%2e%2e`,
`%00`, dotfiles all refused), the body's size limit, events rebuilt from checked fields
only, errors that leak nothing. Each item ships with its check in `tools/dump-server.ts`
or `tools/dump-stats.ts`.

### W1 ⏳ An aborted download leaks a file descriptor

`serveFile` ends in `createReadStream(path)` and `stream.pipe(res)`
(`server/app.ts:175-180`). When the client goes away, `pipe` unpipes and never destroys the
stream, so its descriptor stays open until the process ends: 200 downloads of Conflux's 12 MB
`CSBgraphics.dat`, each closed after its first byte, left 200 descriptors open on it. Enough
of them and `statSync`, `createReadStream` and SQLite fail with `EMFILE`: the site is down
until a restart. A player closing the tab during the first load does the same, a few at a
time.

Paying it: `pipeline(stream, res, …)` from `node:stream`, or `res.once('close', () =>
stream.destroy())`; better, `open` the file and `fstat` the descriptor, which also closes
the window between the `stat` and the open when a data set is replaced live. `dump-server`
aborts a large download and checks that the process's descriptors come back.

### W2 ⏳ `api/stats` is computed whole at every request

Every `GET` or `HEAD` of `api/stats` runs `store.stats()` (`server/app.ts:110-114`): five
aggregates over the whole events table through the synchronous `DatabaseSync`, with
`json_each` over every payload and a correlated `MIN` for every win (`server/stats.ts:64-90`),
returning every won game and every champion name ever. With 200,000 rows it takes 3.6 s,
during which the server answers nothing, and returns 32 MB. A loop of requests is a denial
of service.

Paying it: the answer cached for a minute (or computed on a timer), the lists capped (the
latest or best N wins a set, the top N champions), `api/stats` under a rate limit.

### W3 ⏳ `api/event` takes another site's posts, and any name

- **Cross-origin**: the page posts with `navigator.sendBeacon('api/event', …)`
  (`src/ui/gameEvents.ts:187`), a `text/plain` simple request, and the server checks
  neither `Origin` nor `Sec-Fetch-Site`. Any page can make each of its visitors' browsers
  post invented events, each visitor a rate-limit bucket of their own.
- **Names**: `checkChampions` asks only that a name be a string of at most `MAX_NAME`
  characters (`server/events.ts:99`), so control characters, bidi overrides, NUL (which
  `json_extract` cuts), markup and the empty name are stored, and published by
  `api/stats`, which E39's public statistics will draw.

Paying it: a `POST` whose `Origin` or `Sec-Fetch-Site` names another site is refused; a
name is made of the characters the game's font has (A to Z, the accented letters, space,
punctuation) and is not empty. `dump-stats` checks the refusals.

### W4 ⏳ The events table grows without bound

The only limit is 30 events a minute per address (`EVENTS_PER_MINUTE`,
`server/server.ts:25`; `RateLimit`, `server/events.ts`): no global budget, nothing refusing
a second `won` of the same playthrough, no retention, and an IPv6 client has a /64 of
addresses. One address can add 43,200 rows a day, about 10 MB, on a disk the VPS shares,
and SQLite never shrinks.

Paying it: a global budget a day; `started`, `won` and `lost` unique by type, data set and
playthrough (`INSERT OR IGNORE`); IPv6 counted by its /64; a size check.

### W5 ⏳ The statistics are pseudonymous, not anonymous

`doc/STATISTICS.md` says no address is stored, and E39's FAQ is to insist the statistics
are anonymous. But the nginx block `doc/DEPLOYMENT.md` gives (`:54-60`) sets no
`access_log`, so nginx's default logs the address and user agent of every
`POST /api/event`; `events.time` is to the millisecond (`server/stats.ts`); and the
player's id lives in `localStorage` for ever, with no retention. The log's times link an
address to a player's id.

Paying it: `access_log off` (or a format without the address) for `location =
/api/event`, in `doc/DEPLOYMENT.md` and on the VPS (the author's); the time stored to the
minute or coarser; a retention period; the FAQ saying "pseudonymous", and how to reset the
id.

### W6 ⏳ Security headers

Only a file's answer carries `X-Content-Type-Options: nosniff` (`serveFile`,
`server/app.ts`); `send`, which answers the API and every error, sets none (`:253-258`). No
answer carries `Content-Security-Policy`, `frame-ancestors`, `Referrer-Policy` or HSTS.

Paying it: in `send` and `serveFile`, or in nginx: `default-src 'self'; style-src 'self'
'unsafe-inline'` (the `<style>` in `index.html`), `img-src 'self' data: blob:;
frame-ancestors 'none'; base-uri 'none'`, and `nosniff` on every answer.
`tools/check-image.sh` checks the page still runs under it.

### W7 ⏳ The container, the deploy and the Node version

- `docker-compose.yaml` sets no `mem_limit`, `pids_limit`, `read_only`, `cap_drop` or
  `no-new-privileges`, on a VPS shared with other projects (W2 can push the process to
  hundreds of MB).
- `utils/deploy.sh` builds and ships a working tree that differs from its commit, only
  tagging the build `-dirty` (`:28-32`), and runs no check.
- One Node version is not settled: the image is `node:24-alpine`, a floating tag
  (`Dockerfile:13`, `:22`); `package.json` has no `engines` and `@types/node` `^22`; there
  is no `.nvmrc`; `doc/DEPLOYMENT.md` says 22.18 or later; `CLAUDE.md` and
  `tools/check-frames.sh:117-121` keep a Node 20 workaround, though `npm test` cannot pass
  on Node 20 (`dump-server` runs `node server/server.ts`, type stripping from 22.18, and
  `backup.ts` needs `node:sqlite`'s `backup`). The server is tested on Node 22 and runs on
  24.

Paying it: the limits in the compose file; `deploy.sh` refusing a dirty tree unless forced;
one Node version (`engines`, `.nvmrc`, `@types/node`, the image pinned to a digest), the
Node 20 notes gone.

---

## D — State representation

New state-representation debt goes here, and jumps the queue.

### D17 ⏳ The screen keeps the party it last drew

`Party.setState` builds a new object (`src/engine/Party.ts:118-126`), and the screen keeps
its own reference, `ui.partyState` (`src/renderer/ui/UIState.ts:73`, about 125 uses), set
again only by `GameScreen.setPartyState` from `renderView` and `refreshScreen`
(`src/main.ts:108`, `:115`). Whatever runs between a read and the next of those reads the old
party (R1), and "another game" is detected by the object changing (`setPartyState`'s
`state !== this.ui.partyState`). The freeze has two owners the same way:
`GameScreen.isFrozen()` reads `ui.uiMode`, `Game.isFrozen()` reads `ctx.loop.gameFrozen`.

Paying it: `Party.state` restored in place, as `TimerQueue.restore` and the footprints'
are, or `ui.partyState` a getter over `ctx.party.state`; another game signalled by a
generation count; one owner for the freeze.

### D18 ⏳ The interface's `d.` lives in the screen, and composing the screen changes the world

CSBWin's interface state is `d.`: the open chest and its contents, the attack menu
(`d.AttackingCharacterOrdinal`, `Word20250`, `Word20252`), `PressingEye`, `PressingMouth`,
`DisplayResurrectChestOrScroll`. The port keeps them in `UIState`
(`src/renderer/ui/UIState.ts:202-242`), and the engine reads them back through `GameHost`
queries (`pressingEye`, `pressingMouth`, `displayResurrectChestOrScroll`,
`attackingCharacterOrdinal`, `src/engine/GameHost.ts:47-198`, answered as
`screen?.…() ?? 0` in `src/main.ts:239-242`), beside calls into the UI named by CSBWin
address (`tag02076e`, `tag0207cc`, `tag01b29a`, `tag011366`). So:

- **Composing the screen opens and repacks chests.** `presentViewport` runs
  `syncOpenChest(this.ui, null)` and zeroes `displayResurrectChestOrScroll`
  (`src/renderer/GameScreen.ts:650-653`), and `drawInventoryScreen` opens the chest through
  `syncOpenChest(ui, chestView)` (`src/renderer/ui/Inventory.ts:41`), which unlinks its
  objects from the database (`:363-368`). A compose runs at every refresh, up to 60 a
  second while the pointer moves, so what the engine finds in a chest depends on when the
  screen was last composed. The save repacks by hand first (`GameSaves.ts:289`), and the
  compose skips the inventory under the disk menu so as not to open it again
  (`GameScreen.ts:661-665`). CSBWin opens the chest while drawing too, but only at events
  (`TAG0189d4`).
- A headless `Game` has none of this state, and a read does not reset it (R1).

Paying it: the fields in an engine-owned `ctx.interface` beside `LoopState`, which both
sides read; the chest opened and repacked at the events where CSBWin calls `TAG0189d4` and
`RepackChest` (an inventory toggled, the hand's object or the weapon hand changing, the eye
and the mouth: `doc/CSBwin-src/CSBCode.cpp:7452-7517`, `Character.cpp:1915`, `:3464`,
`:4532`, `:5149`); `presentViewport` only reads; `GameHost` keeps only what leaves the
engine. No pixel moves.

### D19 ⏳ `RuntimeSaveState` is neither strict nor a snapshot

`RuntimeSaveState` is never a file (its header says so, as `DungeonSnapshot`'s does), yet
keeps the shape of the JSON save it once was:

- **Optional fields for an older save that cannot exist**: `item16?`, `timers?`,
  `timerQueue?`, `timerSequence?`, `firstAvailTimer?`, `missiles?`
  (`src/engine/RuntimeSave.ts:41-50`), read through `?? []` and `timerSequence ?? 0`
  (`:135-142`); the snapshot's optional, `null` and `undefined` cases
  (`src/engine/DungeonSnapshot.ts:171-194`, `:384-412`); `Party.setState`'s defaults for "a
  field an older runtime save does not carry" (`Party.ts:115-126`) and `ensureHandOwner`'s
  repair of quick-saves written before `setHandOwner` existed (`Party.ts:213-230`).
- **Not a snapshot**: `getRuntimeSaveState` copies everything but the party, which it hands
  over live (`party: ctx.party.state`, `RuntimeSave.ts:73`); `applySaveGameState` adopts
  the caller's `item16` array (`:159-160`); `Party.setState` copies the champions one level
  deep, so attributes, possessions and skills stay shared. `tools/dump-save-roundtrip.ts:242`
  works round it with a JSON copy.
- **The missiles are restored twice**: the snapshot refills them in place
  (`DungeonSnapshot.ts:105`, source `'snapshot'`), then `applySaveGameState` replaces the
  array with a hand copy of five fields (`RuntimeSave.ts:159-170`). A field added to
  `MissileRecord` would be dropped there, and `DUNGEON_DATA_SOURCES` names the wrong source.
- **A snapshot captured for nothing**: `buildSaveFile` calls `getRuntimeSaveState()`
  (`src/engine/SaveGameFile.ts:125`), which captures the whole world, every record cloned
  and every map in base64, and never reads it, at every F5, Sleepsave and menu save.

Paying it: every field required, the old-save branches and their comments gone; the party
and `item16` deep-copied both ways; the missiles from the snapshot only; a light capture for
the save. Before G29, whose recording would hold such states.

### D20 ⏳ Three record-size tables and two image layouts

A database's record size is written three times: `DungeonLoader.getDatabaseRecordSize`
(`src/data/DungeonLoader.ts:504-512`), `SaveGameLoader.ts:348` and
`CsbwinDungeonImageWriter.databaseRecordSize` (`:275`). They disagree already: database 11
is 256 bytes in one and 0 in another unless `options.expool`, where CSBWin's
`dbEntrySizes[11]` is always `sizeof(DB11)`, 256 (`doc/CSBwin-src/data.cpp:395-413`). The
image's layout is computed twice (`DungeonLoader.calculateOffsets` and
`computeDungeonImageLayout`, which `Chaos` uses), and a save image's missiles and special
locations are parsed twice (`parseMissileRecordsFromSaveData`,
`DungeonLoader.parseMissileDatabase`).

Paying it: one `dbEntrySize(db, shape)` and one image layout for the reader, the writer and
`Chaos`; the missiles and EXPOOL taken from the `DungeonData`. Settling database 11 on
CSBWin's 256 changes the read of a block-less `dungeon.dat` with EXPOOL records, which no
known file is: a separate commit, as for any divergence a refactor finds.

### D21 ⏳ A save has nine shapes

What a save is passes through `ExtendedFeaturesBlock`, `readExtendedFeatures`'s result,
`SaveGameState`, `Block1`/`Block2` and `Block1State`, `CsbwinWorld`, `UtilityGame`,
`DungeonData`, `DungeonSnapshot` and `RuntimeSaveState`.

- **`SaveGameState` is both the reader's output and the writer's input**: some 35 optional
  fields, image contents beside block fields, fields given twice with precedence rules
  (`timerQueue.length ?? block2.numTimer`, `handChar ?? block2.handChar`,
  `sequencedTimers`/`extendedTimers` beside the header's `extendedFlags`). `objectInHand` is
  set twice in `buildSaveFile`, and `block1?` defaults to `emptyBlock1()`, the four zero
  words the utility refuses as "ALREADY UTILIZED".
- **`Chaos` reads and writes the file again**: `Chaos.readGame` (`src/engine/Chaos.ts:102`)
  walks blocks 1 to 6 with its own hash and checksum offsets, and `TAG000fc4` (`:327`)
  writes the scramble and the checksum again.
- **The records' codecs are inverses kept by hand**: thirteen `parse*Database` methods in
  `DungeonLoader` read them, and `CsbwinDungeonImageWriter.writeRecord`'s switch of fourteen
  `record as XRecord` casts writes them (`:388-528`); `DatabaseRecord` is a union with no
  discriminant.
- A load installs the world, then applies a snapshot of that same world over it
  (`src/engine/CsbwinSaveGame.ts:265`).

Paying it, in steps: a codec per database type, `{ size, read, write }` in a `DBType`-keyed
table; one pure `SaveFile` codec with required fields (each block's bytes and its parsed
view), shared by the loader, the writer, `Chaos`, `legacyRows` and `CsbwinSaveInfo`;
`toSaveFile(game)` and `fromSaveFile(game, file)` on the engine's side, and
`RuntimeSaveState` out of the save path. C178 is the kind of asymmetry it removes.

---

## E — Architecture

New architecture debt goes here, and jumps the queue. Every E item is a refactor: the rules
of "How to work this list", point 3, apply, byte-identical tool output included. What the
page redesign adds is the exception: E15's welcome page, E39's pages, and E22.

The structure need no longer follow CSBWin's files (the author's decision): a module may
gather or split CSBWin's functions as the code's concerns ask. What still follows CSBWin is
the behaviour, the names of ported functions, which keep the two codebases greppable
against each other, and the file formats.

### E23 ⏳ One game read, whole or not at all

What a read does is spread over `Game.ts:273-337`, `GameContext.ts:206-215`, `:261-309`,
`CsbwinSaveGame.ts:243-271`, `SaveGameFile.ts:275` and `GameSaves.read`:

- **It is not atomic.** `installCsbwinWorld` sets `ctx.rules`, `ctx.signatures`, the
  overlay and the world before `applyRuntimeSaveState` restores the rest
  (`src/engine/CsbwinSaveGame.ts:243-271`), and `applySaveBytes` turns any error into a
  `SaveFileError` (`src/engine/SaveGameFile.ts:275-283`), after which the full menu says so
  and play goes on: in the new world with the old timers and footprints, when it throws late
  (an `RnMaps.check` in `reloadAfterSaveGame`). CSBWin's `tag01efee` dies.
- **Nothing holds a save against its world**: the party's level, x and y, `numCharacter`,
  `handChar`, `MagicCaster`, the object in hand, the timers' indices. A `csbgame7.dat`
  rewritten with the party on level 40, its checksums made right by the port's own writer,
  installs with the party on level 40 of 14. `readCsbwinParty` drops an unoccupied slot
  inside `numCharacter` and renumbers the rest (`src/data/CsbwinCharacters.ts:293-303`),
  leaving `handChar`, `MagicCaster` and the positions naming other champions; CSBWin does
  not renumber.
- **A new game builds a scratch `Game`**, all seventeen systems, for its effects on the data
  (`CheckMonsters`, `addNewGameSpares`), then takes its state through
  `getRuntimeSaveState` and gives it back, the world encoded in base64 and decoded onto the
  same object. A save builds a throwaway `DungeonState` for `CheckMonsters` alone. The
  rules are read in two places, in two orders (`Game.readNewGameRules`,
  `installCsbwinWorld`); `deleteDuplicateTimers` is set twice (`GameContext.ts:208`,
  `Game.ts:324`); the world has two routes, `GameState.dungeon` and
  `DungeonState.getData()` (typed `Readonly`, written through), which `installWorld` keeps
  in step (`Game.ts:320-321`).
- **What `d.Initialize()` zeroes is reset nowhere** (C181).
- **A read in play** drops no running script (`Game.applyRuntimeSaveState`) and does not
  empty the mouse queue, so clicks queued before F9 are translated against the loaded
  screen.

Paying it: one `readGame(world, runtimeState)` for `dungeon.dat` and saves alike, an
ordered list of steps: validate (a pure `validateCsbwinWorld`), build every piece, then
swap them in at once; an error after the swap is `die(0xbad)`, not a message. A new game's
state from a pure function instead of a scratch `Game`; `GameState.dungeon` gone. The
validation and the swap change what a damaged file does: commits of their own after the
refactor, with a tool of damaged saves.

### E24 ⏳ Two import cycles, and pure helpers in the systems

`MonsterPerception`, `MonsterAttack`, `MonsterDamage`, `MonsterSystem`, `MmRecord` and
`DsaSystem` import values from each other in a cycle, and so do `HintOracleButton` and
`Mouse`. Nothing reads a value at load time today, so it works, but which module loads
first depends on the entry point (a tool entering at `MonsterAttack`), and one table built
at a module's top level would break some entries and not others. Every edge is a pure
helper living in a system's module:

- `MmRecord` imports `DsaVars` from `DsaSystem` (`MmRecord.ts:10`, `:80`), the edge that
  closes the cycle;
- `setPackedBits` and the `monsterDrawAsSize4`, `Invisible`, `Unique` and `Poisoned`
  readers live in `MonsterSystem`, which six modules import for them;
- `DsaSystem` imports the filters' parameter-block codecs from `Feeding`, `MonsterAttack`,
  `MonsterDamage` and `MovementSystem` (`DsaSystem.ts:59-67`): the dependency points the
  wrong way;
- `MonsterSystem` imports `deleteMonsterParameters` and `DeleteMonsterWhy` from
  `MonsterDamage`;
- `HintOracleButton` imports `tag02076e` and `tag0207cc` from `Mouse`
  (`HintOracleButton.ts:25`) for `openHintOracle` and `closeHintOracle`, which only
  `GameScreen` calls.

`src/data/` imports the engine five times: `AltMonGraphics` from `Die`, `CsbwinCharacters`
from `gameTypes` and `attributes`, `HeroExtractor` from `AddCharacter` and `RelativeXY`.

Paying it: `DsaVars`, `DsaVarType`, `StkOp` and the cursor and viewing filters' types in a
leaf `dsa/DsaTypes.ts`; the packed-bit readers in `monsterTypes.ts`; the filters' codecs
beside their interfaces in a `filterParameters.ts`; the two Oracle functions in `Mouse.ts`
or `GameScreen`; what `src/data/` takes from the engine moved down. Then a check in
`npm test` that fails on a value-import cycle.

### E25 ⏳ One helper for each rule, where copies drift

C170 and C171 are copies that drifted. The copies left:

- **Mastery**: `determineMastery`'s options default to "awake" and "no possessions"
  (`src/engine/skills.ts:116-121`, `:150`), and six callers build them by hand
  (`CharacterStats`, `AttackSystem`, `src/renderer/ui/Attack.ts`, `MouseSystem`,
  `DsaSystem`, `PeriodicUpdates`), some leaving them out (C171).
- **`CharacterAtPosition`**: a third copy in `MonsterAttack.getCharacterToDamage` (C170),
  beside the two `AttackSystem.ts:320-322` says had drifted. "Alive" is tested five ways:
  `(health | 0) === 0`, `health === 0`, `health > 0`, `attributes?.health ?? 0`, `!== 0`.
- **A level's difficulty**, `getMap(party.z)?.descriptor.difficulty ?? 0`, six times
  (`AttackSystem.ts:307`, `MonsterAttack.ts:167`, `MagicSystem.ts:453`, `LightLevel.ts:28`,
  `ActuatorSystem.ts:632`, `TimerSystem.ts:1215`).
- **Skill gain on the party's level** is `MagicSystem.applySpellSkillGain` (`:450`), used
  for blows, war cries and throws (`AttackSystem.ts:386`, `:704`, `:1533`,
  `MouseSystem.ts:231`).
- **A spell's RN**, `0xff80 + (x & 0x7f)`, at `TimerSystem.ts:993`, `:1637` and
  `MagicSystem.ts:479-480`, beside `missileHelpers.spellObjectId` (`:26`);
  `adjustSpellMissileRange` and `computeSpellLaunchPos` (`MagicSystem.ts:463-477`) repeat
  `characterThrowsSpell` and `launchObject`; `DsaSystem.ts:4673-4676` repeats
  `MonsterSystem.detachedGroupIndexFor`.
- **The room type**, `(cellFlag >> 5) & 0x7`, written out 28 times beside 4 calls of
  `getRoomType`; the facing byte packed at `WorldMove.ts:616` and `DungeonState.ts:928`.
- **The database dispatch**, five times: two 13-case switches (`DungeonState.ts:460-572`),
  ten `getXxxRecord` getters (`:775-856`), `SmartDiscard.ts:223-230`,
  `objectIndex.ts:86-94` and `MakeMoreRoomInDB.ts:95-98`, beside `DATABASE_KEY` (`:62`)
  and `getRecord` (`:688`).
- **The global text's key**, `((EDT_GLOBAL_TEXT << 24) | (index & 0xffff)) >>> 0`, at
  `Game.ts:185`, `DsaSystem.ts:4098` and `:4113`, and its decode at `DsaSystem.ts:4100-4106`
  and `DecodeText.ts:269-272`; `EDT_SPECIAL_LOCATIONS` and `ESL_MONSTER_MOVE_FILTER` both in
  `CsbwinExpool.ts:40-44` and `DsaSystem.ts:329-351`, and the fifteen `ESL_*` loose
  constants.
- **A menu's press played out**: `playMenuPress` (`src/renderer/ui/Menu.ts`), which the
  settings dialog's EXIT question uses, beside the save menu's own copy of it in
  `beginPress`, `scheduleFrame` and `cancelFrame` (`src/renderer/ui/SaveMenu.ts`).

Paying it: a module of rule helpers (`masteryOf(ctx, champ, skill)`,
`characterAtPosition`, `isAlive`, `levelDifficulty(ctx)`, `adjustSkillsOnPartyLevel`,
`spellObjectId`, `roomTypeOf`); the save menu's press through `playMenuPress`; one `recordsOf(db)` and a generic record getter; the text
codec beside `messageParametersKey`, with an `Esl` enum. After C170 and C171, so that this
commit changes no output.

### E26 ⏳ Systems named after CSBWin's files, not what they do

- **`MonsterAttack` is mostly the champions' health.** Of thirty calls into
  `systems.monsterAttack` from twelve files, one is `monsterAttacks`; the rest are
  `adjustStamina` (8), `damageAllCharacters` (4), `damageCharacter`, `poisonCharacter`,
  `killCharacter`, `curePoison`, `tag011366`, `displayCharacterDamage`, `isCharacterLucky`
  and `quickness`, from `Feeding`, `MovementSystem`, `PeriodicUpdates`, `SwapCharacter`,
  `DsaSystem`…
- **`AttackSystem` holds the end of the game**, `_FusionSequence` and the credits' script,
  about 200 lines, and `applyMagicShield`, which `MagicSystem` calls.
- **`MoveObject` is in two halves.** `WorldMove.ts:172-200` and `MonsterSystem.ts:552-560`,
  `:652-667` each do the missile check, the removal and the pad's release, and the
  levitation test is written twice (`WorldMove.isMonsterLevitating`,
  `MonsterSystem.ts:549`).

Paying it: a `ChampionDamage` system for `Character.cpp`'s damage, death, poison, armour
and luck; `Fusion.ts` for the end; one `MoveObject`, the monster's half calling the shared
parts.

### E27 ⏳ `DsaSystem.ts` is one 5,000-line class

`DsaSystem.ts` (4,976 lines) holds the interpreter, seventeen filter sites, a port of
`MoveObject` for `&MOVE`, and `executeAmpersand`, a single function of 1,231 lines
(`:2003`). In `execute` (`:1544-2000`, 457 lines):

- seventeen `isMaxState(...)` tests, sixteen of which can never fire, since only QUESTION's
  MAXSTATE of 2 fits its field (`doc/CSBWIN_DSA_REFERENCE.md`, `tools/dump-dsa-census.ts`),
  and with them all six `readSignedWord` calls;
- `program[pc++] ?? 0` forty times and `wordsRemaining--` thirty-eight, though
  `wordsRemaining` is always `program.length - pc`;
- `ExecutionPacket`'s `program`, `pc`, `wordsRemaining`, `nextState`, `transferState` and
  `transferCol` set (`:1492-1499`) and copied into every GOSUB's packet, and read by
  nothing.

Five doc comments sit over the wrong function (`:147` over `CursorFilterType`;
`:3276-3279` over `examineCell`, not `noFilter`; `:3609-3615` over `getObjectField`, not
`isCarried`; `:4084-4091` over `globalText`, not `setGlobalText` and `isValidObjectId`),
and seven filter sites have none (`processMissileEncounterFilter`,
`processAdjustSkillsFilter`, `processSpellFilter`, `processTimer5`, `6` and `7`). A spell's
parameters are marshalled field by field both ways (`:1380-1412`, and again in
`MagicSystem.ts:140-155`), where every other block has a codec.

Paying it, in steps, into `src/engine/dsa/`: `DsaTypes.ts` (E24); `DsaMachine.ts`, the
stack, the bank, `execute` over a `ProgramCursor` (`word()`, `nextState(word, shift, bits,
maxState, signed)`) and the state look-ups; `DsaFilters.ts`, one `runFilter(esl, words,
options)` the sites call with their codecs, the spell's included; `ops/` by domain (stack
and arithmetic, objects, `&MOVE`, characters, monsters, the dungeon, text, messages), with
`executeAmpersand` a dispatch over them; `DsaSystem.ts` the façade on `ctx.systems.dsa`.
Each command's body keeps CSBWin's order and names. Two tools change with it:
`tools/dump-dsa-census.ts:37-48` reads the ported operations from the text of
`executeAmpersand` (an exported table instead), and `tools/dump-dsa-delete.ts:121` replaces
`executeAmpersand` on the instance.

### E28 ⏳ The bytecode interpreter decodes through switches and maps built per call

- `executeOpcode` is a 510-line switch (`src/renderer/bytecode/BytecodeInterpreter.ts:414`),
  `resolveStdRectanglePointer` a 208-line one (`:1710`).
- Fifteen functions build an object-literal map at every call (`opWallBitmap`,
  `getStdWallRectanglePointer`, `opFloorPitRectangle`, `opTeleporterRectangle`,
  `opStairRectangle`, `opDoorBitmap`, `opDoorRects`, `opDoorFrameRectangle`, `opDrawOrder`,
  `opWallPosition`, the four `relativeCellFrom*Opcode`…): of the 160 to 195 opcodes of a
  `DrawViewport`, 64 to 70 allocate one.
- A program is found by building `${cellName}_${roomTypeName}`, with an `_Any` fallback, in
  a map of 101 exported `StdDraw*` constants nothing else imports
  (`BytecodePrograms.ts:1962`, `src/renderer/DrawViewport.ts:192-211`), where CSBWin
  indexes `pStdDrawCode[21][8]` (`doc/CSBwin-src/Viewport.cpp:1952`).
- 38 commented-out debug lines (`// StdBltShape(bitmapPtr=${bitmapPtr}, ...)`).
- `InterpreterContext` (`:35-155`) carries the drawing's inputs and the picking's outputs
  alike (`viewportObjectButtons`, `viewportObjectRNs`, the `facing*` flags,
  `doorSwitchRects`, written by `DrawDecorations`, `DrawRoomObjects` and `DrawDoor`, read by
  `src/renderer/ui/ViewportPicking.ts`) in 49 optional fields, so 22
  `if (!tables || !viewport || !getGraphic) return;` draw nothing and say nothing when a
  dependency is missing; `floorBitmap` and `ceilingBitmap` are dead.
- The drawing's state is module-wide: the interpreter's `stack`, `rstack`, `sp` and `rsp`,
  `viewportRandom` (`ViewportDraw.ts:32`) and `graphicRandomState` (`DrawDoor.ts:210`),
  which tools reseed by hand.
- `selectLevel` writes the level's monster colours into the shared tables
  (`tables.monsterColorMapMedium[...]`, `src/renderer/ViewportRenderer.ts:203-208`), the
  game's one `GraphicsTables`, which tools cache per loader. Its comment (`:154-157`) says
  they are applied "whether or not the view is drawn"; its one caller runs only when it is.
- An unknown opcode is a `console.warn` (`:920`), where the renderer reports through
  `GameHost.trace`.

Paying it: one decode table built once (opcode to handler and operand), `pStdDrawCode` as a
21-by-8 array, the rectangle pointers as a table; `draw()` returning the picking for the UI,
the inputs required and a tool helper filling defaults; the drawing's state an object the
`ViewportRenderer` owns; per-level copies of the two colour maps; a `trace` hook. Pixel for
pixel: `tools/dump-render-probe.ts`, `tools/dump-skin-programs.ts` and the golden frames.

### E29 ⏳ `GameScreen` is the canvas, the compose order, the palettes and a façade

`GameScreen` (839 lines, 71 methods, 51 of them one- or two-line forwarders into `ui/`) is
the canvas's output (`putImageData`), the order of the compose, the palettes' choice, and a
façade over the UI and the boot (`getScreenBuffer`, `doMenu`, `setBootFrameRenderer`). It needs an `HTMLCanvasElement`, so no tool can
build one, and `tools/lib/ui.ts` copies its wiring (F19). Each page hook is named four
times: in `UIState`, `UIHooks`, `GameScreenHooks` and the constructor's copy
(`GameScreen.ts:97-119`, `:193-226`, `UIState.ts:432-435`).

Paying it: a `ScreenComposer` without the DOM (the screen's index buffer, the palettes,
`PresentedFrame`, `presentViewport`'s order) and a thin canvas presenter; one factory for the
`ViewportRenderer` and the `UIState`, which the tools use too; `main.ts`'s host calling
`ui/` directly; the hooks spread once.

### E30 ⏳ One presenter and one input router

The screen is drawn by clocks that do not know each other: the engine's `setTimeout` VBL
loop, and `requestAnimationFrame` loops for the chewing mouth
(`src/renderer/ui/Feeding.ts:227-248`), a menu button's press (`SaveMenu.ts:997-1043`), the
intro's VBL (`BootSequence.ts:193-203`) and the CRT (`src/lib/crt.ts:208-223`).

- `renderLastFrame`, which the chew, the menus and Reincarnate draw through, skips
  `refreshScreen`'s `setPartyState` and its `mainLoopHasReturned()` test
  (`GameScreen.ts:775-781`, `src/main.ts:114-118`), so a chew still running when the game ends
  draws the adventure over the credits' wait; `initializePlayState` cancels neither loop.
- The CRT uploads the canvas and runs its shader at device pixels at every display frame,
  changed or not: about 2.3 million pixels a frame at a device ratio of 2, up to 120 times a
  second.
- The rAF scheduler is written twice (`Feeding.ts:229-232`, `SaveMenu.ts:997-1005`, each
  with `as unknown as number`), and a menu's press runs on two clocks
  (`BootSequence.ts:507-510` passes made-up times).
- Input has two stacks, `GameInput` on `document` and the intro's `IntroHost` on `window`.

Paying it: one rAF presenter with a dirty flag that the VBL and the animations set, the CRT
drawing only after a present; one input router, with a focus policy once the page has
controls again. E22 builds
on both: resizing, dialogs over the canvas.

### E31 ⏳ Late wiring with silent defaults, and long parameter lists

- `Game`'s constructor wires callbacks into objects built before it:
  `DungeonState.makeMoreRoomInDB`, `textSubstitution` and `timerWord8Lookup`
  (`DungeonState.ts:90`, `:95`, `:140`; `Game.ts:179-187`), and `SoundQueue.soundFilter`
  (`= () => 1`, `SoundQueue.ts:48`); `TimerSystem`'s constructor writes into `ctx.dungeon`
  (`:94`). A bare `createGameContext` gets, silently, a full database that refuses records,
  untranslated texts and no sound filter, and `systems: {} as GameSystems`
  (`GameContext.ts:307`) types every system as present.
- `TimerQueue.createTimer` takes ten positional parameters and `createTimerWithUByte5`, its
  near copy, eleven (`TimerQueue.ts:200-259`), at 26 call sites
  (`createTimer(TT_LIGHT, 0, 0, 0, 0, time >>> 0, z, undefined, 0, deltaSteps)`,
  `TimerSystem.ts:290`). `WorldMove.resolveCellEffects` takes nine, with
  `objectType = -1` meaning the party (`WorldMove.ts:269-279`).

Paying it: the callbacks as constructor dependencies, with a tool builder that fails on a
missing one (or `GameSystems` partial for a bare context); named constructors per timer
family or an options object; a `PARTY_OBJECT_TYPE` constant.

### E32 ⏳ Four ways to read bytes, and eight graphics caches

- **Bytes** are read through `BinaryFile`, `core/bytes`, `DataView` (`UITables`,
  `CSBGraphicsLoader`) and inline shifts. Only `DungeonLoader` and `GraphicsLoader` use
  `BinaryFile`, both big-endian: its little-endian mode, `RemoteBinaryFile`,
  `readI8`/`readI16`/`readI32`, `peek`, `eof`, `remaining`, `tell`, `setEndianness` and
  `DungeonLoader.load(url)` are unused, and `peekU32LE` exists because the mode is.
  `CsbwinCharacters.setU16BE`/`setU32BE` (`:309-317`) repeat `writeU16BE`/`writeU32BE`;
  `readI16Array` is in both `ObjectTables` and `UITables`; a planar decode is written three
  times (`CSBGraphicsLoader.decodePlanar`, `CsbwinCharacters.readPortrait`/`writePortrait`,
  `ApplyBackground`).
- **Graphics** are cached in eight places with lifetimes of their own, one of them a
  `Map<string, IndexedBitmap>` of four key spaces (`obj:`, `derived:`, `doorOrnament:`…)
  that builds a string at every look-up, and `catch { return null; }` turns every decode
  failure into "nothing drawn" (`src/renderer/ViewportGraphics.ts:22-37`).
  `GraphicsLoader.getImage` caches by index alone and ignores its `format`
  (`src/data/GraphicsLoader.ts:148-155`), so `getPortraitSheet`'s IMG2 fallback
  (`src/renderer/ui/Character.ts:597`) gets the IMG1 decode back and is dead. `toU8` is
  written three times (`ViewportGraphics.ts:78`, `:108`, `:141`).

Paying it: `core/bytes` and a small cursor, the rest deleted; one typed graphics store with
numeric keys, derived graphics under CSBWin's derived numbers, decode failures traced; the
loader's cache keyed by format, or the parameter dropped with the dead fallback.

### E33 ⏳ What a frame costs

- **The palette-to-RGBA conversion is most of a compose**: 0.76 ms of `refreshOverlay`'s,
  where a 16-entry `Uint32` table a palette, written through a `Uint32Array` view, takes
  0.14 ms (`updateImageDataFromIndex*`, `src/renderer/csbwin/CanvasBlitter.ts:409-483`). It
  always takes the two-palette path while adventuring: `viewportPalette !== uiPalette`
  compares two separate copies (`GameScreen.ts:700-703`). Its body is written three times
  in `CanvasBlitter`, and the cursor's footprint loop twice (`reconvertThroughPalette`,
  `PresentedFrame.capture`).
- **Every monster turn allocates** an `MmRecord` and with it a `DsaVars` of two 100-entry
  arrays, in a dungeon without a filter DSA as in one with; every DSA run a `DsaBank`, a
  `DsaStack` and a `DsaVars`; `newDsaParameters` an `Int32Array(101)`.
- About 35 trace strings in `MonsterAI` and 30 in `AttackSystem` are built whether anything
  traces or not.
- `searchOrder()` copies and reverses the timer queue at every
  `deleteMonsterMovementTimers`.

Paying it: the look-up tables built once a present and shared by the three conversions;
`DsaVars` allocated on first use; the traces behind a test or a closure. The frames record
palette codes, so none moves.

### E34 ⏳ Dead code and duplicated types

- **Dead exports**, referenced nowhere but at their declaration: `RemoteBinaryFile`
  (`src/core/BinaryFile.ts:200`), `PositionOriented` and `getCellAttributes`
  (`src/core/types.ts:100`, `:185`), `setActuatorDsaSelector`, `getActuatorBlockDisables`
  (which repeats `blocksDisables`) and `PORTRAIT_RESPONSE_NONE`
  (`src/data/actuatorHelpers.ts:32`, `:112`, `:139`), `ObjectListEntry`
  (`dungeonTypes.ts:510`), `monsterNibble0` (`MonsterDesc.ts:49`), `SLOT_SHIELD_HAND`
  (`gameTypes.ts:18`), `AdjustSkillsFilterParams` and `AdjustSkillsFilterResult`
  (`skills.ts:44`, `:51`), `WALL_BITMAP_WIDTH` and `WALL_BITMAP_HEIGHT`
  (`ViewportGraphics.ts:43-44`), `drawRectOutlineIndex` (`CanvasBlitter.ts:52`),
  `startHint` (`HintOracle.ts:748`), `possibleAttackTypeNames` (`Attack.ts:519`),
  `clampFoodWater` (`Feeding.ts:201`), `SAVE_MENU_PRESS_MS` (`SaveMenu.ts:1045`). About 280 more exports are used only in their
  own file, the 101 `StdDraw*` programs among them (E28).
- **Dead members and code**: `TimerQueue.clear` (`:193`), `PartyFootprints.reset`
  (`:213`), `MovementResult.stepped`, `.blocked` and `.newFacing` (`gameTypes.ts:346-358`),
  `MonsterSystem.detachedGroupIndexFor` (`:911`), `MonsterAI.clearAttacking` (`:1696`),
  `MonsterAttack`'s `RN_*` re-exports (`:39-49`), `BrowserSaveStore.remove` and
  `idbDelete`, `GraphicEntry.image`, `getCacheStats`, `clearCache`, `const result = 0; …
  return result | 1` (`Game.ts:838`), `offset = offset;` (`SaveGameLoader.ts:619-621`),
  `x !== -1 ? x : -1` (`MonsterDamage.ts:368`).
- **Tool-only code in the engine**: `DungeonState.applyDoorActionAtPosition` and
  `applyDoorActionAt` (`:794`, `:937`), an instant door toggle CSBWin does not have, used
  only by `tools/dump-savegame.ts`.
- **Duplicated types**: `RoomType` in `src/core/types.ts:30` and
  `src/renderer/bytecode/Types.ts:16`, the second with the view's 16 to 20
  (`src/renderer/ui/ViewportPicking.ts` imports both, one as `SummaryRoomType`);
  `SoundTableEntry` in `src/audio/soundsIndex.ts:8` and `src/data/tables/UITables.ts:42`;
  `type RN = number` (`bytecode/Types.ts:10`), unbranded, for `rn2` and `text`, which forces
  `as ObjectID` in the interpreter (`:1679`, `popRN`).

Paying it: delete; one `RoomType` and a `ViewRoomType` for 16 to 20; one
`SoundTableEntry`; `ObjectID` in `SummarizeRoomData`; the door toggle in `tools/lib`.

### E35 ⏳ Comments and documents that are stale, wrong, or tell the past

- **Paid debt IDs in the code**, which "How to work this list", point 5, says mean the debt
  is open: E1, E1c, E1d and E2 (`Game.ts:6`, `GameContext.ts:2`, `:53`, `GameHost.ts:2`,
  `LoopState.ts:3`, `MouseQueue.ts:12`, `MouseSystem.ts:9`, `PeriodicUpdates.ts:7`,
  `MagicSystem.ts:9`, `CharacterSystem.ts:10`, `HallOfChampions.ts:7`, `:10`); in the tools
  C14 (`dump-cloud-draw.ts:27`), C23 (`dump-wiggle-monster.ts:5`), C24
  (`dump-monster-move-code.ts:3`), C27 (`dump-champion-death.ts:123`) and D1
  (`dump-throwing.ts:338`).
- **The past**: "Moved out of `Game` by `DEBT.md` E2" (`MagicSystem`, `MouseSystem`,
  `PeriodicUpdates`), `Party.ts:103`, `:218`, `:305`, `RuntimeSave.ts:199-200`,
  `CsbwinSaveGame.ts:4-9`, `:114`, `SaveGameLoader.ts:295-296`, `CsbwinSaveInfo.ts:42-44`,
  `CsbwinDungeonImageWriter.ts:287-290`, `SaveGameFile.ts:229-231`, `MonsterAttack.ts:598`,
  `MissileEncounter.ts:513`, `DrawDecorations.ts:177-179`, `BytecodeInterpreter.ts:1590` ("Phase 5").
- **Wrong**: `MagicSystem.ts:397` ("Spell effects are wired in subsequent magic parity
  steps"); `MonsterAttack.ts:750-751` (`potentialChampionIndex` "still always -1 here",
  which `HallOfChampions.ts:134` sets); `MonsterDamage.ts:452` (a branch without the hook
  that does not exist), and `DamageMonster`'s comment over `damageMonsterGroup`
  (`:480-489`); `SaveGameLoader.ts:501` (ITEM16's `word0` "little-endian in the file", read
  big-endian, as `LE16` on the little-endian build means, `doc/CSBwin-src/CSBTypes.h:151`);
  `CsbwinSaveInfo.ts:9` ("never touches the image"); `CsbwinSaveGame.ts:182`
  (`buildCsbwinRuntimeState` "pure", where `readDisableSaves` removes records from the
  world's `expool`); `DrawViewport.ts:5`, `:156`, `:163` ("the 3D first-person view", and
  doubts on cells 3 and 10 that `relativeX`/`relativeY` settle); `CanvasBlitter.ts:214`
  (R7); `getChampionMessageColor`'s `?? 13`, "the historical default", a guessed number
  (`ActuatorSystem`).
- **Documents**: `doc/CSBWIN_DSA_REFERENCE.md` says `&PARTY@` and `&CHAR@` write nothing
  past 100, where `&CHAR@` zero-fills (`doc/CSBwin-src/DSA.cpp:4179-4227`; the port is
  right), and its last four sections cite `DSA.cpp` without lines;
  `doc/CSBWIN_SAVEGAME_REFERENCE.md:286` says `SimpleEncryption` is neither written nor read
  past the header (the whole file is), and calls block 0 byte-identical with its game
  information (only the round-trip tool's is, C178); `doc/UI_MODULE_MAP.md:40`
  (`pointInRect`, gone), `:79` (the wrappers "delegate and do nothing else", where
  `handleMouseButton`, `setPartyState` and `initializePlayState` hold logic), `:106` (nine
  screen states and a server started by hand: twenty, and the probe starts its own);
  two CSBWin ranges past their file's end, `MoveObject.cpp:797-865` (858 lines;
  `DsaSystem.ts:905`, `doc/PROVEN_FACTS.md` and two tools) and `Sound.cpp:1048-1071`
  (1069; `SoundQueue.ts`, `doc/CSBWIN_DSA_REFERENCE.md` and three tools).

Paying it: each rewritten as the present rule, or deleted.

### E36 ⏳ Type escape hatches that check nothing

`noUncheckedIndexedAccess` is off (it would raise 1,573 errors), so an index's `!` asserts
nothing, and a `?? 0` on a field that cannot be missing hides the type's contract:

- about 76 `x[i]!` in the UI and the intro, 54 of them in
  `src/renderer/intro/HintOracle.ts` (`seg[36]!`, `:629`), and 25 `stack[sp]!` in the
  bytecode interpreter;
- `??` and `?.` on fields that are not optional: `champion.food ?? 0` and
  `attrs?.health ?? 0` (`src/renderer/ui/Character.ts:69-70`, `:153-158`),
  `party.cursorOwner ?? -1`
  (`ActuatorSystem`), `(wallDecorationPos as 0 | 1 | 2) ?? 0`
  (`BytecodeInterpreter.ts:1658`, `:1678`), `slot?.uByte4 ?? 0` hiding a missing ITEM16
  (`MonsterAI.ts:1429`); `CharacterStats.getObjectWeight(item: ObjectID | number | null |
  undefined)`;
- `as ObjectID` on what already is one, which blurs the audit by which a cast marks a
  conversion (`CLAUDE.md` → "Object IDs"): `DsaSystem.ts:1538`, `:1539`, `:2050`, `:4413`,
  `:4616`, `:4628`, `ActuatorSystem.ts:607`, `TimerSystem.ts:1427`, `:1559`, `:1597`,
  `objectIndex.ts` (`NameIndex`), `PeriodicUpdates.ts:67`, `MonsterSystem.ts:750`, `:757`;
- CSBWin's `RNempty` written as `0 as ObjectID` (`ActuatorSystem.ts:350`) and `rn === 0`
  (`objectIndex.ts:82`).

Two compiler checks cost nothing: `noImplicitReturns` and `noImplicitOverride` raise no
error today (`exactOptionalPropertyTypes` raises 34).

Paying it: the casts and `??` removed where the type already says it; `hcsb.dat`'s segment
lengths checked once in `parseHcsbDat`, not by 54 `!`; `noUncheckedIndexedAccess` turned on
module by module where data comes from files (the intro, the renderer, the loaders), in a
`tsconfig` that `npm test` runs; an `OBJECT_ID_EMPTY` constant; the two free flags on.

### E15 ⚠️ The page shell

The page without a known `?dungeon=` is the welcome page (`src/ui/welcomePage.ts`,
`chooseDataSet` in `src/main.ts`): design artboard 1 ("Arrival: choose a dungeon",
`project/Main.dc.html`, `.claude/memory/design-canvas-files.md`), cut down as the
author asked:

- **It is HTML**, no game canvas, nothing of the game built. With a known `?dungeon=`
  the page is the game.
- **At the top, the CSBweb logo** centred (`src/assets/csbweb-logo.jpg`, the author's).
  The design's header goes, with its SETTINGS and CONTROLS links.
- **A grid of the data sets** (`chooserSets`, `src/data/DataSets.ts`), each tile its
  title screen at half size, its name and a line under it. A set the store holds saves of is
  highlighted, the others dimmed. A click selects a tile, a golden border round it
  (the kit's `.pick`).
- **Under the grid, PLAY and CONTINUE**, the kit's `.btn`, centred side by side. PLAY is
  disabled until a set is selected, and starts its game: `?dungeon=<id>`, the title
  animation, then the entrance. CONTINUE is disabled while the store holds no save. It
  reads the last save used (`lastUsedSave`, `src/data/saves/SaveStore.ts`) of the
  selected set, or of every set when none is selected, straight into play: the page
  opens `?dungeon=<id>&save=<row id>`, and the boot reads that row as F9 reads one,
  without the title or the entrance. A box right of CONTINUE previews that save: its
  party, its level and when it was saved.
- **The bottom as the design has it**: the line under the hero, the four columns, and
  the footer, whose links are ABOUT, SOURCE and CREDITS. ABOUT is E39's page; CREDITS
  leads to the credits block above the footer (`#credits`): FTL's team, CSBWin and Paul R.
  Stevens, the Swoosh Construction Kit, DMweb and the Dungeon Master forum. SOURCE is drawn disabled until the repository moves to GitHub, once this
  list is short enough.
- **Fonts**: the game's font for the grid, the buttons, the preview and the
  columns' yellow headings, as the design's kit draws it (artboard 10, "The game's
  font"). The prose, the line under the hero and the columns' paragraphs, is the
  design's Spectral, served with the page rather than from Google Fonts, whose every
  request gives Google the player's address (W5).

The steps, one commit each:

1. ✅ **The welcome page**, in the kit's colours and bevels (`project/dm-kit.css`): the
   logo, the grid as text tiles, the selection, PLAY, CONTINUE with its preview box, and
   the bottom of the page. `tools/probe-frames.mjs` checks the tiles, the selection and
   where PLAY and CONTINUE lead, and enters the entrance by PLAY's click.
2. ✅ **CONTINUE.** The boot reads `?save=`'s row into the game as F9 does, with no
   title and no entrance (`continueSave`, `src/main.ts`; `doc/SAVES.md` → "CONTINUE");
   a row that is not the set's, or not there, or does not read, leaves the entrance.
   `tools/probe-frames.mjs` continues a stored save, and finds its party and the
   screen the entrance's LOAD showed of it, and a missing row's entrance.
3. ✅ **The title screens.** Each tile's picture is its set's thumbnail, the last frame
   of its title at half size, a file in its folder (`thumbnailPath`,
   `src/data/DataSets.ts`) that `tools/gen-thumbnails.ts` writes from the set's
   `graphics.dat`, so the page fetches no game file. `npm test` checks every committed
   thumbnail against the title's frame, and `tools/probe-frames.mjs` that each tile
   shows its own and that the page fetched no `.dat`.
4. ✅ **The fonts.** The labels are HTML text in 'DM Screen', `src/assets/dm-screen.ttf`,
   which ships with the page: the original DM's font, dm-atari's graphics.dat item 0x22d,
   made a TrueType font by `tools/gen-font.ts` (one rectangle per run of lit pixels,
   `tools/lib/ttf.ts`), whatever set the page lists or plays. Its one glyph the game
   lacks is the middle dot, the colon's dot a row down; the at sign, blank in the game's
   font, is left to the browser's. The prose is Spectral's Latin subset, regular and
   italic, under `src/assets/` with its OFL. `npm test` checks the committed font
   against graphics.dat, and `tools/probe-frames.mjs` that the browser draws each of its
   characters as the game draws it, and that no request goes to Google Fonts.
5. ✅ **EXIT.** The settings dialog's EXIT (`src/renderer/ui/SettingsDialog.ts` → "EXIT")
   asks first in `_DoMenu`'s two-option menu, "LEAVE THE GAME?" over "WHAT IS NOT SAVED
   IS LOST", EXIT and CANCEL, then opens the page without `?dungeon=` and `?save=`, its
   other parameters kept (`UIState.onExit`, `welcomePageQuery`). `tools/dump-settings-dialog.ts`
   checks the question and its answers, and `tools/probe-frames.mjs` that the question's
   EXIT opens the welcome page; the question is golden frame 28.
6. ⏳ **What the shell leaves.**
   - **`main.ts` holds the page's features**: the end-of-game flow.
   - **A teleport sends events.** On a page opened with `?dev`, a click on the map
     dialog's square teleports the party by replacing its state
     (`setPartyState({ ...state, position })`, `onTeleport`, `src/main.ts`), with no
     test of the square (into stone, if clicked there) and no `MoveObject`; the game it
     plays reaches the statistics' "where parties die" like any other. A game a
     teleport touched should send no events.

The welcome page and the game are two loads of the page, so E30's two input stacks never
meet the welcome page's controls: PLAY, CONTINUE and EXIT each load the page anew.

### E39 ⏳ The About and Credits pages

The welcome page's footer (E15) links to ABOUT and CREDITS, two pages to be designed with
the author before any code. What they are to hold:

- **ABOUT, with a FAQ.** Among its answers is one paragraph on the statistics the server
  collects (`doc/STATISTICS.md`), and why:
  - to check that the game is actually played;
  - a leaderboard of the preferred champions;
  - where parties die most often.

  It insists that the statistics are anonymous: no player's name, no IP address, no
  browser profiling. A random id, drawn in the browser, is used only for counting
  players. Champions go by the names they carry, which a player can type.
- **The public statistics**, drawn from the server's `api/stats`, on ABOUT or a page of
  their own.
- **CREDITS** is a block of the welcome page (E15). It does not name the data sets'
  authors yet.

### E22 ⏳ The screen's ratio, and a fractional fill

The screen is shown at one ratio. `.screen` (`index.html:57-68`) sizes both canvases from
`#game`'s `--screen-width` and `--screen-height`: 960x600 in the page, and in fullscreen
the largest whole multiple of 320x200 that fits (`src/lib/fullscreen.ts`), a 16/10
picture of square pixels either way. The page will offer the player:

- **The ratio**: 16/10, as now, or 4/3, the ST's monitor, whose 320x200 picture has
  pixels taller than wide.
- **A fractional fill**: fullscreen filling the screen at the chosen ratio, rather than
  the whole multiple.

Both are DISPLAY's settings (`src/settings/Settings.ts`), and the screen's place on the page
is the shell's, so this follows E15. What the change must look after:

1. **One source for both canvases.** The CRT effect's canvas shares `#game`'s grid cell
   and the `.screen` class with the game canvas, so it covers it only while both take
   their size from `#game`'s two variables. A size set inline on one canvas, or a class
   changed on one (`createCrtEffect` copies the class once, `src/lib/crt.ts`), leaves the
   effect off the game canvas, while the pointer, read from the game canvas's own rect
   (`canvasPoint`), stays right: a picture off its clicks. The effect's canvas already
   redraws at whatever size it is shown, in device pixels, and its shader stretches to any
   ratio.
2. **The scanlines are exact only at a whole number of screen pixels per line.** The beam
   is sampled at each pixel's centre (`line` and `beam` in the shader, `src/lib/crt.ts`).
   At 600 pixels, three per line, every gap falls alike; at 720 (3.6) or 1080 (5.4) each
   line is sampled at another phase, a faint uneven banding, worst between two and four
   pixels per line, and below two the lines are noise. The beam is integrated over each
   pixel's height instead of sampled, and the scanlines fade out below about 2.5 pixels
   per line.
3. **Without the effect, a size that is not a whole multiple of 320x200 draws uneven
   pixels** under `image-rendering: pixelated`, some a screen pixel wider than others,
   which is why fullscreen fills by a whole multiple.
4. **The probe pins the default.** `tools/probe-frames.mjs` checks that the effect is
   drawn at 960x600 and maps its clicks through the canvas's rect in a 1600x1000 window,
   and in fullscreen, on a 1920x1080 and a 1366x768 screen, the whole multiple, centred,
   the effect's canvas over it and the pointer read through the curve. It also checks, at
   4/3 and at a fractional fill, that the effect's canvas covers the game canvas exactly
   and that the pointer is read through the curve.

---

## C — Known divergences from CSBWin

A divergence found along the way goes here, with the next free ID.

### C177 ⏳ An Atari-era save loads with its possessions, timers and hand unconverted

For a file with no Extended Features block (`ExtendedFeaturesVersion == '@'`), CSBWin
converts the cells' chains, then the timers' objects (`ConvertTimers`), the champions'
thirty slots (`ConvertCharacters`) and the object in hand, each through
`ConvertListOfObjects` (`doc/CSBwin-src/SaveGame.cpp:2927-2974`). The port converts the
chains only (`convertOriginalDungeon`, `src/data/DungeonLoader.ts:296-303`), on the ground
that a `dungeon.dat` holds no timer, champion or object in hand; a block-less save takes
the same path and holds all three, and `readPossessions` reads the slots as slot numbers
already (`src/data/CsbwinCharacters.ts:86-100`). The port imports a DM save from the Atari
(`buildBlock1State`'s `Byte22596 == 1` branch; its signature matches DM's): a weapon in a
champion's hand, packed `0x1403`, loads as slot `0x1403`, past the 2097 slots, and is gone.
`tools/dump-atari-saves.ts`'s two files have champions who carry nothing.

Paying it: for a file without `objectIndex`, `ConvertListOfObjects` over the timers that
carry an object, each champion's thirty slots and the object in hand, in CSBWin's order
after the chains; a fixture whose champions carry something.

### C178 ⏳ No save keeps the dungeon's game information

`readExtendedFeatures` reads the game-information string (`SaveGameState.gameInfo`),
`DungeonData` has no field for it, and `buildLiveExtendedFeatures` writes
`gameInfoSize: 0` (`src/data/CsbwinExtendedFeatures.ts:933`). So a save of the port's drops
Conflux's 541 bytes of credits, Towers of Chaos's 89, 3D2D1D's 40 and `dm-windows`'s 32,
where CSBWin carries the string from any read into every save
(`doc/CSBwin-src/SaveGame.cpp:1002-1003`) and supplies "No game information was provided"
for a size of 0 (`:249-264`). The comment there says the size was "measured zero" in the
eight committed saves; they hold 32 and that line (`doc/PROVEN_FACTS.md:2393`).

Paying it: the string and its signed size on `DungeonData`, as `hintKey` is, written back; a
save round trip checks that Conflux's survives.

### C171 ⏳ The Firestaff does not soften a monster's blow, and three mastery calls ignore sleep

`MonsterDamagesCharacter` subtracts `2*DetermineMastery(chIdx, 7)`
(`doc/CSBwin-src/Monster.cpp:4576`), without the 0x4000 flag, so the Firestaff in the weapon
hand adds its levels. The port's `determineMastery(champ, 7, {})`
(`src/engine/MonsterAttack.ts:471`) counts possessions only when its options carry
`getObjectNameIndex` (`src/engine/skills.ts:116-121`, `:150`), so a champion holding the
Firestaff takes 2 to 4 more before the floor test, which can then flip `damage <= 1` and
the draws behind it. The same defaults leave out sleep: CSBWin's `DetermineMastery` returns
1 while the party sleeps, and `MagicSystem.ts:249` (a DSA's `&CAST` can run then) and
`CharacterStats.determineThrowingDistance(…, partySleeping = false)` do not ask.

Paying it: the options at these sites (E25 then gives every site one `masteryOf`); a check of
a Firestaff bearer hit with a fixed seed.

### C168 ⏳ A monster north-west of the party never prefers west

`GetPrimaryAndSecondaryDirection`, for a target off both axes, finds the first direction
`dirD4` towards it from north and, when `dirD4 + 1` is not also towards it, tests
`(dirD4 != 0) || (IsItInThisDirection(dirD4 + 3) == 0)`
(`doc/CSBwin-src/Code11f52.cpp:2268-2276`): for north the `||` evaluates the west test, and
a target to the north-west falls through to `STRandomBool`, which gives north then west or
west then north. The port tests `dir + 3` only when `dir !== 0`
(`getPrimaryAndSecondaryDirection`, `src/engine/MonsterPerception.ts:101-117`), where the
loop has already ruled it out, and never for north. So a target to the north-west always
gives north first, and half the time east second, away from the party. Every direction
site of `MonsterAI` and the smell's path (`MonsterPerception.ts:370`) take it.
`doc/PROVEN_FACTS.md:881-895` says the west test's result is discarded, which is the
misreading. Both sides draw one number, so the random stream keeps its length.

Paying it: the west test for north, its result deciding the branch; the fact corrected;
`tools/dump-monster-perception.ts` checks (-1,-1), (-2,-1) and (-1,-2) against a
transcription of the C.

### C169 ⏳ A monster's `timePerMove / 2` is not an integer division

`D4W = sw(timePerMove/2 - w_54)` divides an `i16` (`doc/CSBwin-src/Monster.cpp:1621`; used
at `:1710`, `:2104`, `:2439`). The port writes `frame.timePerMove / 2 -
frame.sinceLastUpdate` (`src/engine/MonsterAI.ts:1074`, and `stepOrDefer`, `:1179`), a
float, and stores the remainder back into `frame.timePerMove` (`:1091`). For an odd move
time, 15 of the 27 monster types (Skeleton 7, Mummy 17, Giggler 3…), a group whose wait is
exactly half defers where CSBWin's moves, the rest of the turn runs with a time of x.5, and
the random stream parts from CSBWin's. Every other division in the file truncates (`:932`,
`:968`, `:990`).

Paying it: `div(timePerMove, 2)` under `sw`; `Process_Invincible`'s tail (`:1074-1091`)
calling `stepOrDefer` instead of repeating it; a check with a Skeleton deferred at
`sinceLastUpdate` 3.

### C170 ⏳ A blow at the party skips a living champion who shares a dead one's corner

`getCharacterToDamage` takes the first champion whose `partyPosition` is the corner, and
gives up on the corner if that one is dead (`src/engine/MonsterAttack.ts:932-936`). CSBWin
asks `CharacterAtPosition`, the first *living* champion there
(`doc/CSBwin-src/CSBCode.cpp:6966`; `Code11f52.cpp:4084`). A recruit takes a corner among
the living only (`src/engine/AddCharacter.ts:67`), so a dead champion and a living one can
share a corner, and the port then hits the next corner's champion. The party's bump into a
wall takes the same path (`MovementSystem.ts:436-438`).

Paying it: `characterAtPosition(party.champions, pos)` (`AddCharacter.ts:84`); a check with a
dead champion and a recruit in one corner.

### C172 ⏳ A dead monster's remains are linked onto the square, not moved there

`CreateAndDropObject` and `DropMonsterRemains` put each dropped object and each possession
on the square with `MoveObject(obj, -1, 0, x, y)` (`doc/CSBwin-src/Code11f52.cpp:832`,
`:943`), so a pad under it fires, an open pit takes it and an object teleporter sends it
on. The port links them with `addObjectToCell` (`src/engine/MonsterDamage.ts:277-283`,
`:388-393`), which does none of these. `killCharacter`, `dropAllPossessions` and
Zokathra's drop already go through `worldMove.moveObject`.

Paying it: `ctx.systems.worldMove.moveObject(rnMaps.setPos(rn, pos), -1, 0, x, y, level)`
at both; a check of a monster killed on a pad that reacts to objects, and of one killed on
an object teleporter.

### C173 ⏳ The DSA's `&ADD` and `&DEL` on a square bypass `MoveObject`

`&DEL` takes an object off its square with `MoveObject(thisObj, x, y, -1, 0)` and `&ADD`
puts its copy on one with `MoveObject(newObj, -1, 0, x, y)`
(`doc/CSBwin-src/DSA.cpp:1702`, `:2057`). The port does both by hand
(`src/engine/DsaSystem.ts:2044-2053`, `:2080-2089`): `removeObjectFromCell` then
`triggerObjectMove`; `setPos`, `triggerObjectMove`, then `addObjectToCell`. What that loses:

- no pit or teleporter on the square is resolved (`WorldMove.resolveCellEffects`, which
  `&MOVE` already uses, `:4413`, `:4606-4621`);
- `unchangedRoom` is always false, where `MoveObject` passes whether the party stands there
  (`Code11f52.cpp:3314-3328`, `:3458-3473`), so floor actuators of types 1 and 2 fire under
  the party where CSBWin's do not;
- the pads run before the object is in the cell, with the copy's new corner already set;
- a monster group added on the party's level gets neither `AttachItem16ToMonster` nor
  `StartMonsterMovementTimers` (`Code11f52.cpp:3410`, `:3439`) and stands inert;
- `CopyItem`'s refusal when `d.ITEM16QueLen >= d.MaxITEM16 - 5` on the party's level
  (`DSA.cpp:1867`) is missing.

Conflux has some 32 `&ADD`, 42 indirect `&ADD`, 26 `&DEL` and 42 indirect `&DEL` sites;
which of them meet a pit, a teleporter, the party's square or a monster is not traced.

Paying it: both through the world `MoveObject` (`objectMover()`, as `findCellSource` and
`findCellDestination` do), then `setPos`; a tool with a pit, a teleporter, the party's
square, and a monster group added on the party's level.

### C174 ⏳ DSA copies that are not whole

- **`&ADD` of a monster group shares its hit points** with the original. The copy is
  `{ ...rec, nextObject, possession, groupIndex }` (`src/engine/DsaSystem.ts:4916-4929`),
  and `CreatureRecord.hp` is an array (`src/data/dungeonTypes.ts:205`) that damage writes in
  place (`MonsterDamage.ts:569`, `:714`, `:831`, `MissileEncounter.ts:399`, `&MONSTER!`):
  a hit on either group hurts both. CSBWin copies the record byte by byte
  (`doc/CSBwin-src/DSA.cpp:1879`). No other record holds an array.
- **`&COPY` of an actuator drops `word8`.** The port copies `word2`, `word4` and `word6`
  (`DsaSystem.ts:2336-2343`); CSBWin copies the whole record past its link,
  `memcpy(((ui8 *)pDst)+2, ((ui8 *)pSrc)+2, sizeof(*pSrc)-2)` (`DSA.cpp:4717`), and `DB3`
  has a `word8` (`CSB.h:1025`), a big actuator's bits 16-17 of its parameters, which
  `STORE` and `&PARAM` can set while the game runs. Conflux has `BigActuators` and about ten
  `&COPY` sites.

Paying it: `hp: [...rec.hp]`; `word8` copied when present; a `dump-dsa-*` check of each.

### C175 ⏳ The DSA's integer widths

- **`&*`** multiplies in doubles and truncates (`bank.stack.pop() * bank.stack.pop()`,
  `src/engine/DsaSystem.ts:2235-2237`), where CSBWin's `i32 * i32` wraps
  (`doc/CSBwin-src/DSA.cpp:2534-2540`). A product past 2^53 loses its low bits:
  `0x7fffffff * 0x7fffffff` gives 0 for 1. Conflux has about 216 `&*`.
- **`&RANDOM`** takes its divisor signed (`this.random.next() % v`, `:2319-2326`); CSBWin's
  is `(ui32)STRandom() % V` with `ui32 V` (`DSA.cpp:2721-2733`), so `&RANDOM` of -1 gives
  the draw itself, not 0.
- **A DSA's state written back**: `void State(i32 s) { m_state = (ui16)s; }`
  (`doc/CSBwin-src/Data.h:2483`), and `PutState` runs whatever the state
  (`DSA.cpp:5464`). The port stores it unmasked (`putState`, `DsaSystem.ts:3853-3854`) and
  skips a final state of -1 (`processTimer6Internal`, `:1510`), so a state of 65536 or more
  lives unwrapped until a save wraps it, and a load changes what the game then does.
- **`CASE`** takes the first match (`:1771-1783`), where CSBWin binary-searches in
  unsigned order (`DSA.cpp:1007-1031`). They differ on an unsorted table, or on a key given
  twice with two targets; Conflux's 781 tables give the same result both ways.

Paying it: `Math.imul`; `(next() >>> 0) % (v >>> 0)`; `& 0xffff` and an unconditional put;
the binary search. A check of each in a `dump-dsa-*` tool.

### C176 ⏳ The DSA goes on where CSBWin stops

- **An unknown command** is traced and skipped (`default: … break;`,
  `src/engine/DsaSystem.ts:1980-1985`), and the loop reads its operands as commands. CSBWin
  says "Unknown DSA command code" and returns the state it started with
  (`doc/CSBwin-src/DSA.cpp:5265`). One `warnedOps` set serves both the commands and the `&`
  operations, so an opcode of one hides the other's warning.
- **The stack has no limit.** CSBWin's holds 100 values and dies on an overflow
  (`0xdcd6`), an underflow (`0xdcd7`) and a pick, poke or roll out of range (`0xdcdb`,
  `0xdcda`) (`DSA.cpp:370-424`). The port's grows without bound and gives 0 for an empty
  pop or a pick out of range (`DsaStack`, `DsaSystem.ts:445-497`), silently, so a DSA that
  pushes in a loop grows until the tab dies.

Paying it: `return exPkt.curState`, and two warning sets; the limit, and `die` with
CSBWin's codes (`src/engine/Die.ts`). A tool feeding each case.

### C179 ⏳ A thrown object drawn as its floor picture is offset and never mirrored

`DrawSingleObject` adds the small offsets only `if (!drawingMissiles)`
(`doc/CSBwin-src/Code51a4.cpp:1907`), and works out the mirror (`LOCAL_36`) for missiles
too, its missile call passing `LOCAL_34 = 0` (`:1810-1816`, `:2572-2578`). The port adds the
offsets always (`drawSingleObject`, `src/renderer/bytecode/DrawRoomObjects.ts:340-346`) and
passes `mirror = false` for every missile (`:758-772`). So an object in flight with no
missile graphic (a torch, food, a potion, a shield) is drawn 2 pixels right and 3 up at
distance 0 (1 and -2 at distance 1, 1 and -1 at 2, with the stock
`smallOffsetIndices[0]`), and the types whose graphic class has `byte4 & 1` (classes 0, 63
and 79) are not mirrored on the right.

Paying it: the offsets behind `!drawingMissiles`, the mirror computed in `drawSingleObject`
with `local34 = false` for missiles; `tools/dump-missile-draw.ts` checks a thrown torch's
rectangle. A golden frame moves only if one shows an object in flight.

### C180 ⏳ `AdjustSkills`' widths, and a gain of 0

`AdjustSkills` adds `(UI16)(experience)` once the Adjust Skills Filter has run, and the
filter can return up to 0xfffff (`doc/CSBwin-src/Magic.cpp:316-325`); the port adds the
whole value (`src/engine/skills.ts:250`, `:258`). And CSBWin runs the filter for a gain of
0, its only `return` for 0 coming after it, where `applySpellSkillGain` returns first on
`experience <= 0` (`src/engine/MagicSystem.ts:451`), as for a failed cast whose
`w4 >> diff` is 0. Only a dungeon with an Adjust Skills Filter DSA sees either.

Paying it: `& 0xffff` on both additions, and a gain of 0 reaching `adjustSkills`; a check
with a filter that returns more than 0xffff.

### C181 ⏳ What `d.Initialize()` zeroes survives a restart

"RESTART THIS GAME" runs `d.Initialize()` before `GameSetup`
(`doc/CSBwin-src/Code1f9e6.cpp:309`), and its `memset (this, 0, sizeof (*this))` zeroes
every `d.` field it does not set again (`DBank::Initialize`, `CSBCode.cpp:333-339`). The
port reads the new game into the same context, and nothing resets `ctx.levelCleared`
(`d.LevelCleared`, `src/engine/GameContext.ts:110-114`, written only by
`MakeMoreRoomInDB`): after a restart, or a new game in the same page, the sweep of a full
database starts from the last game's level. The other `d.` fields the context keeps are to
check the same way.

Paying it: one reset of the context's `d.` fields, called by every new game and restart
(E23's pipeline); a check that a restart's `levelCleared` is zero.

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

### F15 ⏳ Tools that read the wall clock, and a runner with no timeout

- `tools/dump-vbl-clock.ts`'s "MainLoop opens with a tick" check can fail under load and
  pass alone (it failed once in a full `npm test`, sixteen tools at a time). `Game.start`
  sets `vblClockStart = Date.now()` and calls `gameLoop()` at once, which reads
  `Date.now()` again (`src/engine/Game.ts:228`, `:237`, `:449`), so a stall of 17 ms between
  the two runs a VBL inside `start` and spends the opening tick. The tool pins `Date.now`
  for its pacing section (`:129-173`) and not for this one.
- `tools/dump-loop-die.ts` waits `1000 / 60 * failOn + 150` real milliseconds, then checks
  the frames counted (`:23`, `:36`): the same kind, not yet seen to fail.
- `runAsync` waits for each tool's `close` with no limit (`tools/run-checks.mjs:365-375`), so
  a tool left with a handle open hangs the whole suite.

Paying it: both tools on a pinned clock, or the engine's clock taken from `GameHost`, which
would retire the patching of globals; a timeout per tool, reported as a failure with the
output so far.

### F16 ⏳ A tool can pass having checked less than it says

- A scenario that is not found is logged and skipped: `dump-missile-drop.ts:220`, `:227`,
  `:255`, `:261`, `:295`, `:301`; `dump-player-attacks.ts:124`, `:171`, `:272`, `:305`;
  `dump-monster-damage.ts:152`; one in `dump-ten-second-update.ts`. `finish()` fails only a
  run with no check at all.
- `collectSaves` returns `[]` for a folder that is not there (`tools/lib/saves.ts:31-33`),
  its path resolved from the working directory, and eight tools loop over it without
  asking for a single save (`dump-dsa-save`, `dump-file-signatures`, `dump-expool`,
  `dump-dm-rules`, `dump-extend-portraits`, `dump-timer-heap`, `dump-save-menu`,
  `dump-check-monsters`).
- `dump-server.ts:43`, `dump-build.ts:24` and `dump-loop-die.ts:17` write their own
  `check()` and skip `finish()`'s guard, which `tools/lib/check.ts` exists to give.

Paying it: the skips become failures; the saves' folder resolved from `import.meta.dirname`,
a missing one an error; the three tools on `lib/check`.

### F17 ⏳ The frame pipeline and the runner are untyped

The root `tsconfig.json` includes `src` and `tools` and checks no `.mjs`: `run-checks.mjs`,
`probe-frames.mjs`, `probe-ui.mjs`, `compare-frames.mjs`, `lib/frames.mjs`, `lib/png.mjs` and
`lib/buildParty.mjs`, 1,648 lines without `@ts-check`, nor `vite.config.mts`.
`lib/buildParty.mjs:14-33` sends the page a string that calls the engine by name
(`game.systems.hallOfChampions.resurrectReincarnateCancel(160)`,
`game.systems.mouse.handleWallClick()`), so renaming either passes `npm test` and breaks only
`--frames`. `lib/png.mjs` repeats `lib/png.ts`, because the drivers are plain Node scripts.

Paying it: the scripts as `.ts` (Node runs them since 22.18, as it runs the server), under
`tsc` with `vite.config.mts`; one PNG module; `buildParty` a typed function the probe
serialises.

### F18 ⏳ One `tsconfig` for the browser, the tools and the server

`server/tsconfig.json` extends the root's, so the server is checked with
`moduleResolution: "bundler"` and the DOM's types: a server file that imports `./lib`
without its extension, or reads `document`, passes `tsc` and fails in Node with
`ERR_MODULE_NOT_FOUND`. The other way, `src/` is checked with Node's types
(`"types": ["node"]`), so a Node global in browser code passes. The image copies only
`src/data/DataSets.ts` of `src/` (`Dockerfile:29`), while `dump-server` runs the server
from the whole checkout, so an import added to `DataSets.ts` passes `npm test` and
crash-loops the container; only the optional `tools/check-image.sh` would see it.

Paying it: the server on `module` and `moduleResolution` `"nodenext"`, an ES `lib` and
Node's types; `src/` without Node's; `dump-server` running the server from a scratch
folder laid out as the image is.

### F20 ⏳ A tool is run without its types checked

`tsx` strips types without checking them, as esbuild does for `vite build`, so a tool
run on its own with `npx tsx tools/<name>.ts`, the way `CLAUDE.md`, the
`verification-tools` skill and every tool's own header say to run it, passes with type
errors in it or in what it imports. They come out only in `npm test`, whose `tsc
--noEmit` is the gate, and there late: the runner schedules `tsc` with every tool and
prints a failure's output only after the whole run (`tools/run-checks.mjs`, "Failures
print their whole output"), so a type error in a new tool is learnt ~150 s after the
run started. `npm test -- --only=<name>` runs `tsc` and the tool in a few seconds, but
nothing points to it for one tool.

Paying it: one tool is run through the runner, `npm test -- --only=<name>`, in
`CLAUDE.md`, the skill and the tools' `Run:` lines, so its types are checked every
time; and the runner prints a failed `tsc`'s errors as soon as it ends, without waiting
for the tools. The check: a tool with a planted type error fails `--only` on it, and the
full run shows the error before its first tool result.

### F19 ⏳ The tools' screen is wired by hand, and has drifted

`tools/lib/ui.ts:23-36` builds the `ViewportRenderer` as `GameScreen`'s constructor does
(`src/renderer/GameScreen.ts:179-194`), without `gameState`, `rules` and
`csbGraphicsLoader`. So a view a tool draws has `invisibleMonsters` and
`drawAsSize4Monsters` off whatever the dungeon says, no `d.Time` for the magic footprints,
and no CSB graphics.

Paying it: one factory for both (E29); the tools whose output then changes checked against
what the page draws.

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

- **One setting each, off by default**: a flag of `SettingsValues.extras`
  (`src/settings/Settings.ts`), which the game reads as `GameContext.extras` (`Extras`),
  set at every change (`applyToGame`). With every extra off, the game is CSBWin's: every
  tool's output and every golden frame stay the same. The settings dialog's GAME tab
  shows each (`src/renderer/ui/SettingsDialog.ts`), and the page's one Extras button
  turns them all on or off together:
  - `drinkAtFountain`: an empty hand drinking at a water fountain (`drinkAtWaterFountain`,
    `src/renderer/ui/Feeding.ts`, checked by `tools/dump-fountain.ts`);
  - `colourNewMastery`: a mastery just gained drawn in colour 7 on the attribute panel until every attribute
    its level gain raised is back at the maximum that gain gave it, whatever another
    role's level raised since (`src/engine/MasteryGains.ts`,
    checked by `tools/dump-mastery-panel.ts`);
  - `gatherThrownWeapons`: what a champion's THROW or SHOOT sent off gathered back into their possessions when
    the party arrives on the square it lies on, never what the cursor threw: into the
    slot it left, else the quiver, its small-weapon slots first and the object fewest
    slots take first, so a club gathered with daggers keeps slot 12, then the pack
    (`src/engine/ThrownWeapons.ts`, checked by `tools/watch-thrown-weapons.ts`).

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
- **Each ships with its `tools/` check**, run with the setting on, and its entry here is
  deleted as for any paid item.

### X9 ⏸️ Thrown weapons' tags kept across a save

The tags of `src/engine/ThrownWeapons.ts` live only in memory, `GameContext.thrownWeapons`,
and a load clears them (`src/engine/RuntimeSave.ts:152`). A tag holds the record it was
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
- **The check**: `tools/watch-thrown-weapons.ts` goes on through a save and a load: a
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
- **The check**: a new `tools/dump-automap.ts` walks a route on the default dungeon and
  prints each level's codes as a map. It asserts a fake wall seen as stone and a hidden
  pit seen as floor, saves, loads, and compares every code. The same file with the
  records deleted loads with every cell unknown.

---

## H — Deliberate divergences (not debt)

Recorded so that nobody "fixes" them.

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
  `tools/dump-key-bindings.ts` checks every default key.
- 🚫 **Esc opens the settings, and Pause freezes.** CSBWin's tables bind the Atari
  keyscan of Esc, 0x1b: awake and asleep to the freeze, 147, and frozen to the thaw,
  148 (`Byte18400`, `Byte18440`, `Byte18448`, `doc/CSBwin-src/Mouse.cpp:1870-1912`), and
  the shipped `config.txt`'s one other `KEY` line sends it from Esc. The port's `freeze`
  action sends that keyscan from Pause (`DEFAULT_KEY_BINDINGS`), and Esc opens the
  settings dialog, awake, asleep and frozen alike (`GameInput.keyDown`,
  `src/renderer/ui/SettingsDialog.ts`). A left click on the pixel x 0, y 198 still
  freezes, and a click anywhere still thaws. `tools/dump-settings-dialog.ts` and
  `tools/dump-freeze.ts` check both keys.
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
- 🚫 **The data set chooses DM's rules, not the player.** CSBWin's "DM Rules" menu item
  toggles `DM_rules` at any time (`doc/CSBwin-src/CSBUI.cpp:933-935`), and its Linux build
  takes `--dmrules` at the launch (`LinCSBUI.cpp:677`). The port has no toggle: a file's
  Extended Features block sets the rules (`readRulesOptions`), and where it has none the
  manifest's `dmRules` gives `DMRulesDesignOption` its value at the start
  (`DataSet.dmRules`, `src/data/DataSets.ts`), which the boot turns into `DM_rules`. The
  three DM sets on the Atari files carry it, as CSBWin's own DM package carries `DMRules`
  in its block (`doc/PROVEN_FACTS.md` → "`DM_rules` and `DMRulesDesignOption`…").
  `tools/dump-dm-rules.ts` checks that `dm-atari` boots with `DM_rules` on, and
  `tools/dump-data-sets.ts` that no set with a block is given the flag.
- 🚫 **The canvas shows an Atari intensity times 36, not RGB555.** CSBWin hands Windows
  RGB555 pixels, its straight palette each intensity `i` as five bits `(i << 2) | (i >> 1)`
  (`CreateOverlayTable`, `doc/CSBwin-src/Graphics.cpp:3096-3117`), which Windows widens to
  8 bits as `(v << 3) | (v >> 2)`: intensities 0-7 show as 0 33 74 107 148 181 222 255.
  The port's canvas shows them as `i * 36`, 0 36 72 108 144 180 216 252
  (`atariIntensity`, `src/renderer/csbwin/CanvasBlitter.ts`, and `atariToRGB`,
  `src/core/types.ts`), up to 6 a channel apart. Only
  the viewport through an overlay, a tint or a jitter is CSBWin's RGB555 widened
  (`src/renderer/csbwin/OverlayScreen.ts`), so while one is up the viewport and the panels
  show the same Atari colour up to 6 a channel apart. `tools/dump-overlay-screen.ts` prints
  both. To revisit when frames are compared with CSBWin's ("Priority", postponed):
  the golden frames hold palette slots, not colours (`tools/lib/frames.mjs`), so RGB555
  on every screen would move none of them.
- 🚫 **An object in hand keeps its colours over the dungeon view** (X4). CSBWin draws the
  cursor rows from screen row 29 down as the object's colour-4 silhouette while the view
  is shown (`doc/PROVEN_FACTS.md` → "An object in hand is a colour-4 silhouette over the
  dungeon view"). The port draws the icon itself and shows those pixels through the
  interface palette, so neither the light nor the level's monster colours reach it
  (`drawCursorItem`, `src/renderer/ui/Mouse.ts`, and `GameScreen.presentViewport`). The
  arrow over the right-hand panel and the message area is kept. It is
  `UIState.colouredObjectCursor`, on by default. It becomes one of the player's settings
  (`src/settings/Settings.ts`) once a tab of the settings dialog carries it; `tools/dump-object-cursor.ts` checks it both ways.
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
  does (`tools/dump-extended-decorations.ts`, section 3).
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
- 🚫 **RISE raises DM's champions with the utility disk's portraits** (X8). CSBWin's
  utility copies a champion's portrait as the saved game holds it (`TAG002724`,
  `doc/CSBwin-src/Chaos.cpp:3264-3451`), and only its unported champion editor gave one
  a `.CMP` of the utility disk. RISE's dialog has NEW FACE on whenever it opens, and a
  champion whose portrait is a cell of DM's graphic 26 is raised with the utility's
  redrawn face of them (`swapInNewFaces`, `src/engine/Chaos.ts`; `doc/SAVES.md` → "RISE
  makes a save of its own"). OLD FACE makes CSBWin's adventure, byte for byte
  (`tools/dump-rise.ts`).
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
- 🚫 **The boot shows the Atari ST disk's FTL logo before the title**, which CSBWin
  never had: `SWOOSH.IMG`'s picture, palette script and sound
  (`src/renderer/intro/Swoosh.ts`, `doc/ATARI_ST_DISK_REFERENCE.md` → "The logo in the
  port"), whenever the manifest's `"swoosh"` folder serves `swoosh.img`. It is not an
  extra: the author wants it on every boot. The player's startup animations
  (`SettingsValues.startupAnimations`, on by default) turn it off together with the title
  animation from `graphics.dat`; the entrance is then the first screen.
- 🚫 **`?intro=0` skips the whole intro**: the logo, the title animation and the
  entrance. This is a developer affordance with no CSBWin counterpart, kept deliberately:
  most of the golden frames boot through it, and so does `tools/probe-ui.mjs --boot`.
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
  `tools/probe-frames.mjs` checks that a click opens and closes an inventory.
- 🚫 **DONE on the Hint Oracle's title list closes it.** CSBWin's goes back to the load
  screen (`w_4 = 1`, `doc/CSBwin-src/Hint.cpp:7375-7388`), whose floppy prompts and save
  chooser only lead to a square, and the port's Oracle has the party's
  (`HintOracleScreen.run`, `src/renderer/intro/HintOracle.ts`).
- **Not debt** (listed so it is not raised again):
  - Table names like `byte20090`, `word1074` and `uByte590` are CSBWin's own
    (`d.Byte20090`…), kept greppable by rule.
  - Names like `tag0207cc`, `TAG02076e` and `_FusionSequence` are CSBWin's, kept wherever a
    module gathers or splits the functions (E27, E28): the structure need no longer follow
    CSBWin's files, but a ported function stays greppable against its C++.
  - `src/renderer/intro/PrisonLevel.ts` imitating part of `DungeonState`'s API is a
    deliberate, documented stand-in dungeon.
