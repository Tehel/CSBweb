# The port's saves

What a save is here, how saves are told apart, and the dialog behind the disk icon. The
file itself is CSBWin's, block for block: `doc/CSBWIN_SAVEGAME_REFERENCE.md` has its
layout and how much of it the port writes and reads. CSBWin's own disk menu, and the
places the port's dialog diverges from it, are in `doc/CSBWIN_MENU_REFERENCE.md` →
"Deliberate divergences in this port". This document is the rest: the port's own design,
where CSBWin has four files in a directory and nothing to say.

Everything goes through `GameSaves` (`src/engine/GameSaves.ts`), which is built with the
game, its data set and the store. It is where every save is built and written to the
store (the disk menu's SAVE and F5) and where a save's bytes are read back into the game
(LOAD, the boot's chooser and F9).

## What a save is

- **A CSBWin `.dat` file, and nothing else.** `buildSaveFile`
  (`src/engine/SaveGameFile.ts`) writes it, all sixteen blocks, and `applySaveBytes` reads
  it back as a genuine save. A file the port wrote before its RNs were CSBWin's slots
  does not load, here or in CSBWin: it leaves slot 0 of the maps free, `0xff`/`0xffff`,
  and writes door 0 in corner 0 as 0, which `checkIndirectIndex` refuses
  (`doc/PROVEN_FACTS.md` -> "An `RNVAL` read as a slot is `dbUNKNOWN`"). What a file does
  not hold, a load does not give back, as in CSBWin: `src/engine/CsbwinSaveGame.ts` →
  "What is not restored" is the whole list (a blow not yet taken off the HP, the open
  inventory, and the like), and `tools/dump-save-roundtrip.ts` saves and loads three
  played games and holds everything that differs to it. F5 saves nothing where the disk
  icon does nothing: a champion still being chosen has no place in a file, and the key
  answers "CANNOT SAVE NOW". A
  `.dmweb.json`, the JSON wrapper earlier builds wrote around such a file, is not read:
  the store's upgrade kept of each the file it carried as `raw`.
- **Every save is a row of IndexedDB** (`SaveRecord`, `src/data/saves/SaveStore.ts`): the
  file's bytes beside what the list needs. The level, the champions' names and the
  playthrough (below) are read from the file's own blocks when the row is written; the
  data set, the date, when the save was last used, the play time and whether F5 wrote it
  are the row's own. Nothing is JSON, and no row holds anything a `.dat` could not be
  listed without.
- **The store upgrades its older rows** (`src/data/saves/legacyRows.ts`, run once by
  `idb.ts`). To version 2, it keeps of each older row the CSBWin file alone, out of its
  `.dmweb.json` when it is one, and reads the row again from that file. An older row
  names no data set, so every one becomes the default set's; a row that holds no CSBWin
  file, which no build could load, is dropped. To version 3, it stamps a playthrough
  into each file that names none ("A playthrough"). To version 4, it gives each file
  that holds 0 in all four of `GAMEBLOCK1`'s `Byte22598`, `Byte22596`, `Word22594` and
  `Word22592` the 1, 2, 1 and 13 `_ReadEntireGame` sets before a read
  (`stampBlock1Rows`; `doc/PROVEN_FACTS.md` → "`GAMEBLOCK1`: what `SaveGame` writes
  there"). CSBWin never writes the zeros, an early build of the port did, and a load
  carries a file's own words into the game's next save, so every save of a playthrough
  begun on that build holds them, and the utility's RISE refuses such a file as
  "ALREADY UTILIZED". The author's decision: the store's rows are stamped, once, and a
  file imported later is left as it is, refused as CSBWin's utility refuses it.
  Nothing else in `src/` reads JSON. A
  `.dmweb.json` file on disk is converted by hand, outside the engine;
  `tools/peek-dungeon.ts` reads one.
- **No store on disk.** IndexedDB (`BrowserSaveStore`) is the one store: a directory on
  disk needs `showDirectoryPicker`, which is Chromium's alone. **Export** downloads the
  selected save's bare `.dat`, which CSBWin opens: the row's bytes as the store holds
  them, under the row's name (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`).
  What the row alone holds, its date, its play time and whether F5 wrote it, stays
  behind. **Import** is a `.dat` dropped on the page while the dialog is up, the disk
  menu's or the entrance's chooser (`bindSaveDrop`, `src/ui/saveDrop.ts`): the whole
  page, since the CRT effect shows a canvas of its own over the game's, and a file
  dropped with no dialog up is swallowed rather than opened by the browser. There is
  no file picker. The row keeps the file's name, numbered while a save has it, and
  the file's date, as CSBWin ranks its slots by their files' `MODIFIEDTIME`
  (`doc/CSBwin-src/CSBCode.cpp:9766-9800`); it counts no time played, and is the last
  save used (`GameSaves.importSave`, `src/engine/GameSaves.ts`). A file that does not
  read is CSBWin's "SAVED GAME DAMAGED!" (`SaveGame.cpp:1906`).
- **A save knows its dungeon.** A row carries its data set's id, and the list shows the
  running data set's saves only (`GameSaves.dataSet`). The filter is the list's
  parameter, not its rule: RISE lists every set's (below), since a DM save feeds a CSB
  game. CSBWin keeps a game's saves in that game's directory (`CSBGAME.DAT`
  to `CSBGAME4.DAT`, `doc/CSBwin-src/CSBCode.cpp:9747-9756`), and guards against the
  wrong graphics with the signatures an Extended Features block may carry
  (`expectedGraphicSignature1/2`, `SaveGame.cpp:378-379`, checked at
  `Graphics.cpp:1784-1815`), which the port neither checks nor writes.
- **RISE makes a save of its own.** On an entrance whose data set has a `mini.dat`,
  CSB's, RISE opens the chooser over every data set's saves (`SaveMenu`'s `rise` mode,
  `src/renderer/intro/PrisonDoor.ts`), and its LOAD is CSBWin's UTILITY → "MAKE NEW
  ADVENTURE" on the save chosen (`GameSaves.makeNewAdventure`, `src/engine/Chaos.ts`).
  The new file is a row of the running set, named after the source's with `-csb` before
  its `.dat`, and a number after that while a save has the name; its playthrough is the
  file's, the source's `RandomGameID` with its first byte one higher, so a source raised
  twice makes two saves of one playthrough, as CSBWin writes the same id twice; it counts
  no time played. Then it is read, and the game starts in it. A refusal stores nothing,
  and is the utility's message in the entrance's one-button menu, whose OK goes back to
  the entrance.
- **An import is checked against the dungeon.** A `.dat` holds no name of its dungeon,
  but it holds the dungeon (blocks 7-14). A dungeon's signature is one digest per level, of
  its walls: the level's width and height, and one bit per cell, stone or anything else
  (`dungeonSignature` over `levelWalls`, `src/data/DungeonSignature.ts`).
  Nothing finer: a teleporter a release moved, or a cell whose type play changed, leaves
  the signature alone, and a player seldom knows which release a save came from. So the
  four Dungeon Master sets are one dungeon, and a save of one is a save of any. The
  digest is SHA-256, through `crypto.subtle`, which a browser and Node both have built
  in, a browser in a secure context alone. The author's decision: the page is served
  from localhost and will be hosted over https, so it is always there, and nothing
  stands in for it. The file's signature is read from its world (`loadCsbwinWorld`), so
  a file whose image is damaged is refused there. A save is its
  dungeon's when every level matches, and the dungeon has no other level. A save of
  another dungeon is refused, with the
  dungeon it looks like named when the port knows it ("switch to it", or "not supported
  yet"), which is the known dungeon most of its levels match (`identifyDungeon`), each
  level against the level of its own number. **A save that is most of the running
  set's own dungeon and not the whole is asked about**, the author's decision: "THIS
  LOOKS LIKE A SAVE FROM A MODIFIED VERSION OF" and the dungeon's name, over CONFIRM
  and CANCEL. Confirmed, it is stored as a row of the running data set, the set of the
  dungeon it looks like, and the row is marked unofficial (`SaveEntry.unofficial`),
  as are the saves of a game read from such a row; nothing reads the mark yet.
  Cancelled, nothing is stored. So "switch to it" never names
  the dungeon a save is refused in (`checkDungeon`). That takes a catalogue of
  known dungeons' signatures (`KNOWN_DUNGEONS`), each with the data sets that play it,
  which may list dungeons the port cannot play: so the digests are committed, not read
  from the page's files, and a tool holds each to the file here. It lists five: Dungeon
  Master; Chaos Strikes Back, which is `mini.dat`'s, and its prison, the set's
  `dungeon.dat`, both the `csb` set's; Kids dungeon 24; and 3D2D1D. Conflux's enciphered
  `dungeon.dat` is not read, so it has no signature. A dungeon is added from what
  `tools/dump-dungeon-signature.ts` prints when given its file: the digests as the
  catalogue lists them.
- **Play time is the player's**: wall-clock time in the game, the frozen game and the
  open dialog left out. The file's `d.Time` is not it (sleep runs it fast). The game
  counts it in VBLs, sixty a second (`Game.playTime`, `src/engine/Game.ts`): the wall
  clock paces them, and a gap the loop does not make up, a machine asleep, counts
  nothing. The row carries it, in milliseconds (`SaveEntry.playTime`): a save writes
  the count, a load takes the row's, and a new game starts at 0. A row stored before
  rows held it counts none. An export loses it and an import starts at 0. The dialog's
  preview shows it.

## A playthrough

- **`d.RandomGameID` names it**: drawn when a new game is read
  (`doc/CSBwin-src/SaveGame.cpp:1523-1532`), kept in `GAMEBLOCK1` (offset 308, written at
  `:1060`), carried by the port as `block1.randomGameID`, and what CSBWin itself tests
  for "THAT'S NOT THE SAME GAME" (`:1605-1606`). It is drawn before the Hall of
  Champions, so it names a game from its first step, whoever is in the party. Two new
  games differ: `CsbRandom` takes its seed from `Math.random` at its first draw
  (`src/core/random.ts`), as CSBWin seeds from the system time (`CSBCode.cpp:350`).
  A drawn id is never 0: where CSBWin keeps a product of 0, the port draws again
  (`drawRandomGameID`, `src/engine/GameContext.ts`; `DEBT.md` H).
- **No stored save holds 0**, which names no playthrough. A file of an earlier build
  holds it. The author's decision: **a
  file takes its id as it enters the store.** The id is that of an existing save that
  has one, of the same dungeon (the row's data set) and the same party (the same
  champions' names, in the same order), the newest when several do (`joinedPlaythrough`,
  `src/data/saves/SaveStore.ts`); with none, a new one, drawn as a new game's is. It is
  stamped into the file, `GAMEBLOCK1`'s `RandomGameID` and nothing else of the game
  (`stampRandomGameID`, `src/data/SaveGameLoader.ts`), so the row and its file agree
  and an export carries it. The store's upgrade to its version 3 stamps the rows of an
  earlier version by that rule (`stampSaveRecords`, `src/data/saves/legacyRows.ts`),
  one row at a time, so that the rows of one party and data set are one playthrough;
  the page gives it a stream of its own to draw from (`src/main.ts`). The import is
  the other way in, by the same rule and from the same stream
  (`GameSaves.importSave`). So 0 is no special value to the game: a load takes the
  file's id as it is, as CSBWin does (`doc/CSBwin-src/SaveGame.cpp:1610`), and the
  game's saves carry it. The draw still never gives 0.
- **No id drawn here is a stored save's.** CSBWin's draw is the
  product of two 16-bit words from consecutive draws of one stream, and two games draw
  the same id about once in 16 million pairs (measured once, over 4 million draws of
  `drawRandomGameID`): 8 chances in 100,000 for a store of fifty playthroughs. Across
  data sets nothing follows, since every comparison is a data set's. Within one, two
  playthroughs of one id would share F5's slot, so one's quick-save would be written
  over the other's; F9 would load whichever of them saved last; neither confirmation
  would be asked between them; and the dialog would list them as one. The author's
  decision: whenever the port draws an id, a new game's or one for a file that holds
  none, it draws again while a row of the data set holds that id (`drawPlaythrough`,
  `src/engine/GameSaves.ts`). CSBWin's formula stays. The engine draws a new game's
  with no store at hand (`newGameBlock1`, `src/engine/GameContext.ts`), so the page
  holds it against the store once the game is read and before it runs
  (`GameSaves.newGameRead`), from the game's own stream; a store that cannot be listed
  leaves the id as drawn. What is left is an imported file whose own id
  is a local playthrough's, which nothing tells from a save of that playthrough, since
  a party changes within one.
- **F5 has a slot of its own**, one per playthrough, written over at each press. It never
  touches a save made from the dialog, which is what is left when a quick-save was made
  at the wrong moment. The slot is the playthrough's newest quick-save in the data set
  (`quickSlot`, `src/data/saves/SaveStore.ts`); a press writes its file and its date
  there, under the row's key and name, and the first press makes the row. **F9 loads
  the playthrough's newest save**, the quick slot or another, and finds none in a
  playthrough not saved yet, a new game's. Both are the player's, not debug features,
  and what they did is printed in the message area ("The two keys").
- **SAVE writes over the selected save**, or makes a new one from the heading of the
  running game's playthrough; a game with no save yet has no heading, and makes its
  first from the list's "new save" row. The row written over keeps its key and its name
  and takes the file, its date and the game's playthrough, and is the dialog's save from
  then on: a quick-save written over is F5's slot no longer, and the next F5 makes
  another. On another playthrough's heading SAVE does nothing, the author's decision: a
  file holds the running game's id, so a new save is never another playthrough's.
  **LOAD takes any save**, and from a heading the last save used of its playthrough.
  Either asks first when the save, the one read or the one written over, is of another
  playthrough than the running game's; the order of two saves of one playthrough is
  never checked, since loading an old save and saving over a newer one is ordinary
  play. The question is `_DoMenu`'s two-option menu in the
  dialog's place: CSBWin's own line for a save of another `d.RandomGameID`, "THAT'S NOT
  THE SAME GAME" (`doc/CSBwin-src/SaveGame.cpp:1605-1606`), over the action and CANCEL
  (`asksFirst`, `src/renderer/ui/SaveMenu.ts`). The boot's chooser has no game behind
  it and never asks.
- **The last save used**, loaded or written, is the dialog's selection when it opens,
  the boot's chooser's too. The author's decision: each row holds the time it was last
  used (`SaveEntry.usedAt`), set by a write and by a load that read, and the last save
  used is the data set's row with the latest (`lastUsedSave`,
  `src/data/saves/SaveStore.ts`). Nothing is kept beside the rows, and using one save
  writes nothing to another's row. A load sets that time alone (`SaveStore.markUsed`);
  a row stored before rows held it counts from its date. With no save in the data set,
  the dialog opens on "new save".

## The dialog

The disk icon opens it over the 320×200 buffer (`src/renderer/ui/SaveMenu.ts` over
`Menu.ts`, a faithful `_DoMenu` / `_WaitForMenuSelect`), and the entrance's "Resume"
opens the same one, load-only.

- Its own layout over nearly the whole 320×200 buffer, in the game's style (graphic 0's
  pieces, `_DoMenu`'s colours and font): not one of `_DoMenu`'s four layouts.
- **The layout**: 304×184 at (8,8), on a screen cleared to black, in the game as at the
  entrance: an 8-pixel ring of the game's picture would show nothing whole. Three pieces
  of graphic 0 make it, each drawn at the size wanted by keeping its corners and
  repeating its middle (`drawPiece`): the grey frame, the sunken panel and a button
  frame. Two panels
  side by side, the list's (210 wide: 32 characters a row and the scrollbar) and
  the preview's (65 wide, 10 characters), over one row of four buttons: LOAD, SAVE and
  EXPORT under the list, CANCEL under the preview. A button that can do nothing has no
  label, as CSBWin's empty slot has none. The labels' places in their frames, the
  rectangle a click takes and the press animation are `_DoMenu`'s. The question before
  a load or a save is `_DoMenu`'s centred menu, alone on the cleared screen.
- **A two-level list**: a heading for each playthrough, named by the champions of its
  newest save, and under it, folded or not, its saves, newest first, each with its day,
  its time, its level and, on F5's, "QUICKSAVE" (`layoutRows`). The playthroughs are in
  the order of their last
  use, a playthrough's being that of the save of its own last used
  (`playthroughsOf`, `src/data/saves/SaveStore.ts`). The dialog opens with the first
  unfolded, the last save used selected under it, and the others folded; a click on a
  heading folds or unfolds it, and so do the left and right arrows. A game with no save
  yet has no heading, and the full menu a first row, "NEW SAVE", in its place.
- **The list scrolls** under its fifteen rows, which fill its panel with two pixels of
  it above and below, beside a scrollbar in the manner of a
  GEM window's, in the dialog's two colours, the option's orange on the panel's brown
  (`drawScrollbar`, `src/renderer/ui/SaveMenu.ts`): eleven columns against the panel's
  right edge, outlined; a hollow arrow on a stem in a box at each end; between them a
  slider, plain, whose height is to the track's as the rows shown are to the list's,
  in a track dithered of the two colours where rows lie beyond the panel. A list that
  fits has the whole track for a slider. A click on an arrow scrolls a row, as a notch
  of the wheel does; the slider is not dragged, and the track takes no click. Scrolling
  does not move the selection, which may leave the panel; a key that moves the
  selection scrolls the list back to it (`scrollBy`, `showSelection`).
- **A preview** beside the list, of the save LOAD would read: the selected save, or
  from a heading its playthrough's last save used, and nothing on "NEW SAVE". A line of
  the panel each, on the list's rows (`formatSavePreview`,
  `src/data/saves/SaveStore.ts`): the champions' names without their titles, the level,
  the play time as `H:MM:SS`, and the day and the time it was saved. A party of fewer
  than four leaves its lines empty, so the rest stands in one place for every save.
- **The dialog's message**, what went wrong, what was done or "WORKING...", is the last
  lines of the preview's panel, in the title's colour: wrapped at the panel's width
  (`wrapMessage`, `src/renderer/ui/SaveMenu.ts`), five lines at most, over whatever
  lines of the preview it needs. A move of the selection takes it down.
- **LOAD, SAVE, EXPORT**, and a drop for the import. No delete, no quit and no "SAVE AND
  QUIT": loading another playthrough's save is how a player leaves a game. **A dropped
  save of the dungeon is listed at once**, selected, under "SAVE IMPORTED", and nothing
  is loaded (`saveMenuDrop`, `src/renderer/ui/SaveMenu.ts`). The dialog takes no drop
  while it is working, pressing a button or asking. What is not stored is said in
  `_DoMenu`'s centred menu in the dialog's place (`importMenu`): the question for a
  modified dungeon, "THIS LOOKS LIKE A SAVE FROM A MODIFIED VERSION OF" over the
  dungeon's name, with CONFIRM and CANCEL; and under OK alone, "THIS LOOKS LIKE A SAVE
  OF" the other dungeon, with "SWITCH TO IT TO IMPORT IT" or, for a dungeon no data set
  plays, "NOT SUPPORTED YET", or "THIS IS A SAVE OF AN UNKNOWN DUNGEON". Esc and a
  right-click dismiss either. A file that does not read is the dialog's message.
  **EXPORT is
  for the selected save**, and has no label on a heading or on "NEW SAVE", where none
  is: a heading's preview is of the save LOAD would read, and EXPORT does not take it.
  It leaves the game alone, so it never asks, whatever the save's playthrough, and the
  save is no more the last one used for it; the dialog stays up and says "SAVE
  EXPORTED" (`doExport`, through `UIState.onExportSave` to the page's
  `downloadSaveFile`). **A double
  click on a save is LOAD**: a second click on it within half a second of the first
  (`SAVE_MENU_DOUBLE_CLICK_MS`, `src/renderer/ui/SaveMenu.ts`), with the button's press
  and its question. Not on a heading, which a click folds.
- **CANCEL, Esc and a right-click close it.**
- **The same dialog at the entrance and in play**: the chooser takes the clicks, the
  wheel and the keys the disk menu takes, less SAVE and the question. The wheel and the
  keys reach the list in play and at the entrance, whose chooser is up before the
  page's own listeners are bound (`createIntroHost`,
  `src/renderer/intro/BootSequence.ts`).
- **No "GAME LOADED, READY TO PLAY."**, nor its "ASCII DUMP" (`DEBT.md` G14): a
  loaded game is played at once. It is CSBWin's `_TAG021028` menu
  (`doc/CSBwin-src/CSBCode.cpp:10493-10537`), so its absence is an entry of
  `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". The boot's
  hand-off keeps the fade to black and the cleared screen that menu gave the chooser's
  picture (`tag021028`, `src/renderer/intro/BootSequence.ts`).

## The two keys

F5 writes its playthrough's quick-save, over the last, and F9 loads the newest save of
its playthrough, F5's or the dialog's ("A playthrough"). Each key says what it did on a
line of the message area, in white (`GameSaves.tell`; `doc/CSBWIN_MESSAGES_REFERENCE.md`):
"GAME SAVED" or "GAME LOADED"; "CANNOT SAVE NOW" with no party, with a champion still
being chosen, or while a script holds the loop, and "CANNOT LOAD NOW" for that last;
CSBWin's own "UNABLE TO SAVE GAME!" (`doc/CSBwin-src/SaveGame.cpp:1266`) and "CAN'T FIND
SAVED GAME!" (`:1585`) for a write that failed and for no save at all; a file that does
not read gives the line the dialog's message would be. Each outcome is also a line for
the console, with the save's name, and with the error behind a failure.

## What the dialog leaves out

None of these was in the dialog's scope, and none is debt:

- **No delete.** `BrowserSaveStore.remove` has no caller.
- **No file picker** for an import: the drop is the one way in.
- **No "SAVE AND QUIT"** (`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in
  this port").

An unknown dungeon played from its save is `DEBT.md` G22.

## Evidence

`tools/dump-save-menu.ts` drives `GameSaves` and the dialog over a store in memory; its
sections are named below. Node has no IndexedDB, so no tool runs `BrowserSaveStore`
itself: neither the IndexedDB half of the upgrades (`upgradeRows`) nor
`BrowserSaveStore.markUsed`.

- **RISE**: `tools/dump-rise.ts` (the row a new adventure is stored as, again, and a
  refusal; the chooser's `rise` mode over every set's saves, its LOAD and a refusal).
- **The row and the store's upgrades**: "the one save call" and "the store's upgrade"
  (version-1 rows through both upgrades; which rows join a named save and which draw, in
  either order of the rows; each row's file holding the row's id; a stamped file being
  byte for byte the file the game writes under that id, and loading; a row's draw held
  to its own data set's rows; a row that holds no CSBWin file dropped; an upgraded row
  counting no play time; a file holding the four `GAMEBLOCK1` words at 0 refused by
  RISE, then stamped into the file the game writes with CSBWin's, taken by RISE, and
  loading with them; a file that holds one of them left as it is).
- **The stamp**: `tools/dump-save-stamp.ts`, over the eight genuine saves and the two of
  `static/gamefiles/csb`. The stamped file differs in six bytes of `GAMEBLOCK1`, the id
  and the word the block's fold ends on; it reads back with the id, the level and the
  party; its own id stamped back gives the file byte for byte; a CSBWin block stamped is
  what `ScrambleAndWrite` writes, and `mini.dat`'s 127 fold words that are not zero are
  kept. No genuine save holds the four `GAMEBLOCK1` words at 0, and one that holds
  CSBWin's 1, 2, 1 and 13 stamped with them is the file byte for byte.
- **The playthrough a file that names none joins**: "the list" (which save is joined).
- **F5's slot and F9's choice**: "the list" (which row is the slot), "the one save call"
  (a second F5 writes over the first, and SAVE does not) and "one store, two data sets"
  (F9 in its playthrough, and in one with no save).
- **SAVE over the selection**: "the one save call" (the row written over, F5's slot
  written over, another playthrough's save) and "the menu's selection, and what SAVE
  writes" (the dialog's own clicks and keys).
- **The two confirmations**: "the question before a load or a save across playthroughs"
  (which LOAD and which SAVE ask, that nothing is done before the answer, and what each
  answer does).
- **The last save used**: "the list" (which row it is, and a row from before the field),
  "one store, two data sets" (F9's load marks its row, in its set alone) and "the menu's
  selection, and what SAVE writes" (either menu opens on it, scrolled to it; a read that
  fails marks nothing; a load writes the time alone).
- **The play time**: "the play time" (the VBLs counted, and those of the frozen game and
  of the disk menu left out; SAVE's and F5's rows; LOAD and F9 taking the row's; a save
  and a load exact to the VBL; a read that fails; a row from before the field; a new
  game).
- **A drawn id is no stored row's**: "a drawn playthrough is no stored save's" (a store
  holding the ids a pinned stream draws first, and each game taking the next; another
  data set's saves; a store that cannot be listed).
- **The frame**: "the dialog's pieces of graphic 0" (each piece at its own size is the
  art), "the dialog" (the margins, clean panel under every row and label, ten characters
  fitting the preview's panel, the scrollbar against the panel's edge), "the menu button
  sets" (a frame's rectangle and label against CSBWin's table) and "the menu's
  selection" (CANCEL, the arrows).
- **The two-level list**: "the list" (the playthroughs and their order, a heading's and
  a save's row) and "the two-level list" (three games' saves in one store: which heading
  is first and unfolded and which save selected; a click folding and unfolding; from a
  heading, LOAD reading the last save used, asking across playthroughs, and SAVE making
  a new save on the game's own and inert on another's; the "new save" row of a game with
  no save; the load-only chooser).
- **The preview and the message**: "the list" (a play time's format, and a preview's
  lines) and "the preview" (the panel read back: which rows hold ink and that none
  leaves the lines' cells; "NEW SAVE" showing nothing, a heading its last save used, and
  the load-only chooser the same; a message on the panel's last lines, as many as it
  wraps to, and taken down by a move of the selection).
- **The scrolling**: "the scrolling" (twenty-one rows, the bar read back from the
  screen: the slider's place and height at the first row, between and at the last page,
  the checkerboard around it, the outlines, the two arrows; an arrow's click and the
  wheel scrolling a row and leaving the selection out of the panel, and a draw not
  scrolling back; the track and the slider taking no click; a key bringing the list
  back; a list that fits having the whole track for a slider).
- **The double click**: "the double click".
- **EXPORT**: "EXPORT" (no label and no click on a heading, and on "NEW SAVE" in "the
  menu's selection"; on a save, the press, then one file under the row's name, the
  store's bytes byte for byte, which read as a CSBWin save; no row written and the game
  left alone; another playthrough's save without a question; a read that fails; the
  load-only chooser).
- **A dungeon's signature, and the catalogue**: `tools/dump-dungeon-signature.ts` (the
  digest's input on a level made by hand, and the digest against `node:crypto`'s; every
  data set's `dungeon.dat` and CSB's `mini.dat` a catalogue dungeon that lists the set,
  whole, no entry without its file and no digest listed twice; the eight genuine saves,
  from `d.Time` 70 to 127290, and the two of `static/gamefiles/csb`, each its own
  dungeon's and matching no level of another; the port's own save; on the late save's
  world, a cell's attributes, objects and type among those not stone changing nothing, a
  wall opened or a cell walled changing its level's digest alone, the size in the
  digest, and a save of thirteen levels of the fourteen being most of Dungeon Master and
  not the whole; `checkDungeon` in each of the four Dungeon Master sets and in `csb`,
  one level of fourteen being a modified version, and a known dungeon no data set
  plays).
- **The import**: "the import" (a genuine save stored under its file's name, date and
  playthrough, byte for byte, and again under a numbered name; a file that names no
  playthrough joined to its party's or given the first its stream draws, stamped, the
  game's stream left alone; a save with one wall opened stored only once confirmed,
  unofficial, and the saves of a game read from it unofficial too, SAVE's and F5's, but
  not a new game's nor one written over the row by another game; a Chaos Strikes Back
  save, a save with a wall of every level opened, and four files that do not read, none
  stored; the `csb` set taking its two saves and refusing Dungeon Master's).
- **The drop and the dialog's answers**: "the drop" (every known dungeon's two menus
  within the title panel's four lines of 33 characters; no drop taken with no dialog up;
  a genuine save listed, selected and previewed under "SAVE IMPORTED", nothing loaded; a
  save with one wall opened asked about, the screen `_DoMenu`'s own drawing of the
  question, which a click off its buttons, Enter, the wheel and another drop leave up,
  CANCEL, Esc and a right-click take down with nothing stored, and CONFIRM answers with
  an unofficial row; a Chaos Strikes Back save and one of an unknown dungeon refused
  under OK; a text file as the dialog's message; no drop taken during a press; the
  load-only chooser importing a genuine save, which LOAD then plays).
- **No "GAME LOADED, READY TO PLAY."**: `tools/dump-bad-saved-game.ts`, "a save read"
  (the hand-off after a load is one fade and four VBLs on a cleared screen, and waits
  for no click).

What only a browser has, the frames probe checks (`tools/check-frames.sh`): that either
menu takes a notch of the wheel and the entrance none, and that the chooser's selection
follows the arrow keys; that EXPORT, clicked in the entrance's chooser in a Chrome told
to announce a download and keep none, starts one, a `.dat` under the save's name; and
that the `csb` set's save dropped on the entrance's chooser is taken by the page, that a
menu comes up, and that its OK brings the chooser back with nothing more listed.

Two golden frames: `tools/frames/06-savemenu.png`, the dialog in play, and
`tools/frames/12-game-loaded.png`, the loaded game's first view, straight from the
chooser's LOAD. The first shows the "NEW SAVE" row alone, its preview empty and its list
with the whole track for a slider, since the frame script clears IndexedDB;
`dump-save-menu.ts` proves the rows.
