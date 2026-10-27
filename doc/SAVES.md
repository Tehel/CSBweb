# The port's saves

What a save is here, how saves are told apart, and the dialog behind the disk icon. The
file itself is CSBWin's, block for block: `doc/CSBWIN_SAVEGAME_REFERENCE.md` has its
layout and how much of it the port writes and reads. CSBWin's own disk menu, and the
places the port's dialog diverges from it, are in `doc/CSBWIN_MENU_REFERENCE.md` →
"Deliberate divergences in this port". This document is the rest: the port's own design,
where CSBWin has four files in a directory and nothing to say.

Everything goes through `GameSaves` (`src/engine/GameSaves.ts`), which is built with the
game, its data set and the store. It is where every save is built and written to the
store (the disk menu's SAVE, F5 and the Sleepsave) and where a save's bytes are read back into the game
(LOAD, the boot's chooser, F9 and the welcome page's CONTINUE).

## What a save is

- **A CSBWin `.dat` file, and nothing else.** `buildSaveFile`
  (`src/engine/SaveGameFile.ts`) writes it, all sixteen blocks, and `applySaveBytes` reads
  it back as a genuine save. A file the port wrote before its RNs were CSBWin's slots
  does not load, here or in CSBWin: it leaves slot 0 of the maps free, `0xff`/`0xffff`,
  and writes door 0 in corner 0 as 0, which `checkIndirectIndex` refuses
  (`doc/PROVEN_FACTS.md` -> "An `RNVAL` read as a slot is `dbUNKNOWN`"). What a file does
  not hold, a load does not give back, as in CSBWin: `src/engine/CsbwinSaveGame.ts` →
  "What is not restored" is the whole list (a blow not yet taken off the HP, the open
  inventory, and the like), and `tools/checks/save-roundtrip.ts` saves and loads three
  played games and holds everything that differs to it. F5 saves nothing where the disk
  icon does nothing: a champion still being chosen has no place in a file, and the key
  answers "CANNOT SAVE NOW". A
  `.dmweb.json`, the JSON wrapper earlier builds wrote around such a file, is not read:
  the store's upgrade kept of each the file it carried as `raw`.
- **Every save is a row of IndexedDB and its file** (`SaveEntry` and `SaveFileRecord`,
  `src/data/saves/SaveStore.ts`), in two object stores, `saves` and `saveFiles`, under
  one key, written and deleted in one transaction: a list reads the rows alone, and a
  file is read only to be loaded or exported. The level, the champions' names and the
  playthrough (below) are read from the file's own blocks when the row is written; the
  data set, the date, when the save was last used, the play time and whether it is F5's
  or the Sleepsave are the row's own. Nothing is JSON, and no row holds anything a `.dat` could not be
  listed without.
- **The store upgrades its older rows** (`src/data/saves/legacyRows.ts`, run once by
  `idb.ts`). To version 2, it keeps of each older row the CSBWin file alone, out of its
  `.dmweb.json` when it is one, and reads the row again from that file. An older row
  names no data set, so every one becomes `dm-atari`'s, the one set there was; a row that holds no CSBWin
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

  Each step runs on a store of a version before its own alone (`upgradeStoredRows`).
  Version 5 adds an object store to the database, `dataSets`, the player's own data sets
  (`src/data/LocalDataSets.ts`, `BrowserDataSetStore`), and changes no row. To version 6,
  each row's file goes to `saveFiles`, under the row's id, and the row is kept without
  it (`splitSaveRecord`); a store at version 6 is not read at all. The steps after version 2's
  keep a row they cannot read as it is: the store is a save's only copy, and a reader
  made stricter must not delete it.
  Nothing else in `src/` reads JSON. A
  `.dmweb.json` file on disk is converted by hand, outside the engine;
  `tools/peek-dungeon.ts` reads one.
- **Another tab** (`openSaveDatabase`, `src/data/saves/idb.ts`). A tab lets the store go
  when another opens it at a later version (`onversionchange`), so a new build's upgrade
  is never held up by an old build's tab, and the old tab's next open fails with "THE
  GAME WAS UPDATED IN ANOTHER TAB. RELOAD THIS PAGE". A tab of a build from before that
  rule does not let go: the new tab's open is then refused at once with "CLOSE THE GAME IN
  YOUR OTHER TABS, THEN TRY AGAIN", and so is every open after it, until the other tab
  lets go and the first goes on. Neither waits, so ENTER starts the game regardless (its
  playthrough unchecked against the store's, `GameSaves.newGameRead`), and the save
  menu, F5 and F9 show the message. A row written over (`markUsed`) is read and written
  in one transaction. The first write of a page, a save or a data set, asks the browser
  to keep the store (`navigator.storage.persist()`, `askToPersist`), which a store
  "best effort" may lose under pressure.
- **No store on disk.** IndexedDB (`BrowserSaveStore`) is the one store: a directory on
  disk needs `showDirectoryPicker`, which is Chromium's alone. **Export** downloads the
  selected save's bare `.dat`, which CSBWin opens: its file as the store holds it, under
  the row's name (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`).
  What the row alone holds, its date, its play time and whether it is F5's or the
  Sleepsave, stays behind. **Import** is a `.dat` dropped on the page while the dialog is up, the disk
  menu's or RESUME's chooser, never RISE's (`bindSaveDrop`, `src/ui/saveDrop.ts`): the whole
  page, since the CRT effect shows a canvas of its own over the game's, and a file
  dropped with no dialog up is swallowed rather than opened by the browser. There is
  no file picker. The row keeps the file's name, numbered while a save has it, and
  the file's date, as CSBWin ranks its slots by their files' `MODIFIEDTIME`
  (`doc/CSBwin-src/CSBCode.cpp:9890-9924`); it counts no time played, and is the last
  save used (`GameSaves.importSave`, `src/engine/GameSaves.ts`). A file with no
  `GAMEBLOCK1` where CSBWin reads one, the first thing `_ReadEntireGame` checks
  (`doc/CSBwin-src/SaveGame.cpp:1724-1726`, `ReadUnscrambleBlock` at
  `CSBCode.cpp:9272-9300`), is "NOT A SAVED GAME" (`readsGameBlock1`,
  `src/data/SaveFile.ts`): a `dungeon.dat`, a `graphics.dat`, any other file, and
  a save cut short before the end of that block. CSB's `mini.dat` holds one, and is a
  save. A file that has one and does not read past it is CSBWin's "SAVED GAME DAMAGED!"
  (`SaveGame.cpp:2117`). CSBWin says that line of both, as it only ever reads its own
  four names: the second line is the port's, for a file the player chose.
- **A save knows its dungeon.** A row carries its data set's id, and the list shows the
  running data set's saves only (`GameSaves.dataSet`). The filter is the list's
  parameter, not its rule: RISE lists every set's (below), since a DM save feeds a CSB
  game. CSBWin keeps a game's saves in that game's directory (`CSBGAME.DAT`
  to `CSBGAME4.DAT`, `doc/CSBwin-src/CSBCode.cpp:9871-9880`), and guards against the
  wrong graphics with the signatures an Extended Features block may carry
  (`expectedGraphicSignature1/2`, `SaveGame.cpp:380-381`, checked at
  `Graphics.cpp:1808-1839`). The port does not check them. It keeps those a read gives
  and writes them back (`ctx.signatures`).
- **RISE makes a save of its own.** On an entrance whose data set has a `mini.dat`,
  CSB's, RISE opens the chooser over every data set's saves (`SaveMenu`'s `rise` mode,
  `src/renderer/intro/PrisonDoor.ts`), and its LOAD is CSBWin's UTILITY → "MAKE NEW
  ADVENTURE" on the save chosen (`GameSaves.makeNewAdventure`, `src/engine/Chaos.ts`).
  The dialog says so: a title panel over the list reads RAISE A PARTY INTO A NEW / CHAOS
  STRIKES BACK ADVENTURE, the list below it holds eleven rows, LOAD reads RISE, and
  there is no EXPORT. Nor is there an import: a file dropped on it is refused as with
  no dialog up, and the import's hint never shows (`saveMenuTakesDrops`). The dialog
  raises a party from a save already stored: a DM save from CSBWin is imported in a DM
  set first, and a CSB one through RESUME's chooser.

  In EXPORT's frame is a toggle, on whenever the dialog opens: NEW FACE while on, OLD
  FACE while off. On, each DM champion raised gets the CSB utility disk's redrawn
  portrait of them, which the original utility's champion editor put on a champion by
  hand and CSBWin does not port (`doc/ATARI_ST_DISK_REFERENCE.md` → "The portraits").
  A champion is known by their portrait, never by their name, which REINCARNATE may
  have changed: one whose portrait is cell `charID` of DM's graphic 26, pixel for
  pixel, gets cell `charID` of `utility-portraits.dat` (`src/data/UtilityPortraits.ts`).
  A portrait that is no DM champion's, the prison's or one drawn in an editor, stays,
  and names and titles are never touched. The new portraits are written into the
  source's `CHARDESC`s where the utility's `TAG00439e` swaps the editor's in, before
  `TAG002724` copies them (`swapInNewFaces`, `src/engine/Chaos.ts`), so they are in
  the file, and CSBWin shows them too. Off, the adventure is CSBWin's, byte for byte.
  The toggle is the port's own, outside the extras' setting, and a set without
  `utility-portraits.dat` has none. The prison's "BEGIN THE ADVENTURE?" asks for no
  faces: its party's are CSB's own.
  The new file is a row of the running set, named after the source's with `-csb` before
  its `.dat`, and a number after that while a save has the name; its playthrough is the
  file's, the source's `RandomGameID` with its first byte one higher, so a source raised
  twice makes two saves of one playthrough, as CSBWin writes the same id twice; it counts
  no time played. Then it is read, and the game starts in it. A refusal stores nothing,
  and is the utility's message in the entrance's one-button menu, whose OK goes back to
  the entrance.

  CSBWin makes a CSB game in three steps (`doc/CSBwin-src/Chaos.cpp:1-5`): the prison
  is played, its party saved as `CSBGAMEn.DAT` (`SaveGame.cpp:926-932`); the utility
  makes the new adventure from that save; and the door's RESUME loads it. RISE is the
  second step, and in play the port offers it too, below.
- **The prison asks "BEGIN THE ADVENTURE?".** The prison has no way out, and its text
  at (9,2) of level 0 says "FIRST CHOOSE YOUR CHAMPIONS...THEN SAVE THE GAME... THEN
  RESTART WITH THE UTILITY DISK." So a game is the prison's when its `Word22592` is 12,
  as the compressed `dungeon.dat` sets it, in a set with a `mini.dat`
  (`GameSaves.inPrison`), and there the game asks, YES and NOT YET, in `_DoMenu`'s
  two-option menu in the save dialog's place (`askBeginAdventure`,
  `src/renderer/ui/SaveMenu.ts`):
  - after a save, the disk menu's SAVE or F5, whatever the party's size: YES makes the
    adventure from that save, and NOT YET is the list again, or no dialog after F5;
  - once the fourth champion has joined, RESURRECT or REINCARNATE run to its end
    (`GameHost.championJoined`), the party being full: YES first writes F5's quick-save,
    so the prison's save stays and can be raised again from the entrance, and NOT YET
    closes the dialog.

  YES stores the adventure as RISE does, named after its source with `-csb`, and reads
  it, so the game goes on in it. A refusal, or a write or a read that fails, is the
  dialog's message, over the list.
- **An import is checked against the dungeon.** A `.dat` holds no name of its dungeon,
  but it holds the dungeon (blocks 7-14). A dungeon's signature is one digest per level, of
  its walls: the level's width and height, and one bit per cell, stone or anything else
  (`dungeonSignature` over `levelWalls`, `src/data/DungeonSignature.ts`).
  Nothing finer: a teleporter a release moved, or a cell whose type play changed, leaves
  the signature alone, and a player seldom knows which release a save came from. So the
  Dungeon Master sets from 1.1 on are one dungeon, and a save of one is a save of any.
  The two 1.0 disks' are its variant (`KnownDungeon.variantOf`), level 6 without the
  skeleton closets 1.1 added: a save of either release in a set of the other is a slightly
  different dungeon, and neither is ever the "other" dungeon of a set of the other. The
  digest is SHA-256, through `crypto.subtle`, which a browser and Node both have built
  in, a browser in a secure context alone. The author's decision: the page is served
  from localhost and will be hosted over https, so it is always there, and nothing
  stands in for it. The file's walls, each level's width and height beside the
  signature (`dungeonWalls`), are read from its world (`loadCsbwinWorld`), so a file
  whose image is damaged is refused there.

  The file is held first against **the running set's own dungeons**, as its files read
  (`GameSaves.ownDungeons`): its `dungeon.dat`, and the `csb` set's `mini.dat`, whose
  save is the game. They are read from the set's files whatever the running game was
  read from, a new game or a save, and never from the running world, whose walls a save
  or a script may have changed. A file that will not open or read is left out, and the
  console says why. The author's rules (`checkDungeon`):

  - **The same number of levels, each as wide and as high**, as an own dungeon's: the
    file is held against that dungeon alone. Every level's digest the same, it is the
    set's own, and stored. Some the same and not all, it is a **slightly different
    dungeon**, asked about in `_DoMenu`'s three-option menu: "IT SEEMS THIS SAVE IS FOR
    A SLIGHTLY DIFFERENT DUNGEON", over LOOK FOR A BETTER MATCH, IMPORT ANYWAY and
    CANCEL. The first option is the wide button of the layout, the only one that holds
    its label. IMPORT ANYWAY stores it as a row of the running set, marked unofficial
    (`SaveEntry.unofficial`), as are the saves of a game read from such a row; nothing
    reads the mark yet. LOOK FOR A BETTER MATCH holds it against the other sets, as
    below, and the dialog says what they make of it. None the same, it is another
    dungeon, refused as an unknown one.
  - **Any other**, a level more or less or a level of another size, is not the set's,
    and goes on to **the other sets**: the known dungeon most of its levels match
    (`identifyDungeon`), each level against the level of its own number, among the
    catalogue's dungeons and the published sets' that do not list the running set.
    Between two that match as many, the one the save is the whole of comes first, then
    one whose levels are the save's in number and size, as an own dungeon's are; only a
    published set's sizes are known. A save of another dungeon is refused, the dungeon
    named, with "switch to it" where a data set plays it and "not supported yet" where
    none does; a save that matches no level of any is an unknown dungeon's, refused.
    Neither list names the running set's own dungeon, which its files say better, so
    "switch to it" never names the set a save is refused in.

  The published sets' dungeons are the server's: each published set's row keeps its
  `dungeon.dat`'s walls, which `api/data-set-walls` answers (`doc/DEPLOYMENT.md` → "The
  game files and the manifest"). The page asks for them only when an import goes on to
  the other sets (`publishedDungeons`, `src/main.ts`), and keeps the answer for the
  session; where the server cannot answer, the console says why, that import is held
  against the catalogue alone, and the next asks again. A published set's name is a
  player's, up to 60 characters. It is folded first to what the game's font draws, which
  is ASCII alone: its accents dropped, and `?` for a character with no glyph
  (`foldToFont`, `src/renderer/csbwin/TextRenderer.ts`), as is an error's message the
  dialog shows. Where "THIS LOOKS LIKE A SAVE OF" and the name do not fit the title
  panel's two lines of 33 characters, the name is cut at a word and ends in `...`
  (`fittedTitle`, `src/renderer/ui/SaveMenu.ts`).

  This holds for every set, the site's and a player's own alike: a local set's author
  keeps their saves while they move its walls, by IMPORT ANYWAY, and a set the catalogue
  does not list, a published one, takes the saves of its own `dungeon.dat`. The check is
  for imports only: a save already filed under the set is read without it.

  The catalogue of known dungeons' signatures (`KNOWN_DUNGEONS`) lists each with the data
  sets that play it, and may list dungeons the port cannot play: so the digests are
  committed, not read from the page's files, and a tool holds each to the file here. It
  lists seven: Dungeon Master; Chaos Strikes Back, which is `mini.dat`'s, and its prison,
  the set's `dungeon.dat`, both the `csb` set's; Kids dungeon 24; 3D2D1D; Conflux 3.5;
  and The Towers of Chaos 3.3. A dungeon is added from what
  `tools/checks/dungeon-signature.ts` prints when given its file: the digests as the
  catalogue lists them. It names none of the players' dungeons: the published ones are
  the server's, and a player's own is not named in another set.
- **A save is its own world.** A save, once stored, holds its dungeon and loads it,
  whatever the set's `dungeon.dat` has become since: a player who changes their local
  set's dungeon sees none of the changes in a game read from an older save. Deleting a
  local set, from its form on the welcome page, deletes every save filed under its id
  with the record, in one transaction (`BrowserDataSetStore.remove`), once the
  confirmation has counted them.
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
  (`doc/CSBwin-src/SaveGame.cpp:1638-1647`), kept in `GAMEBLOCK1` (offset 308, written at
  `:1085`), carried by the port as `block1.randomGameID`, and what CSBWin itself tests
  for "THAT'S NOT THE SAME GAME" (`:1730-1731`). It is drawn before the Hall of
  Champions, so it names a game from its first step, whoever is in the party. Two new
  games differ: `CsbRandom` takes its seed from `Math.random` at its first draw
  (`src/core/random.ts`), as CSBWin seeds from the system time (`CSBCode.cpp:360`).
  A drawn id is never 0: where CSBWin keeps a product of 0, the port draws again
  (`drawRandomGameID`, `src/engine/GameContext.ts`; `DEBT.md` H).
- **No stored save holds 0**, which names no playthrough. A file of an earlier build
  holds it. The author's decision: **a
  file takes its id as it enters the store.** The id is that of an existing save that
  has one, of the same dungeon (the row's data set) and the same party (the same
  champions' names, in the same order), the newest when several do (`joinedPlaythrough`,
  `src/data/saves/SaveStore.ts`); with none, a new one, drawn as a new game's is. It is
  stamped into the file, `GAMEBLOCK1`'s `RandomGameID` and nothing else of the game
  (`stampRandomGameID`, `src/data/SaveFile.ts`), so the row and its file agree
  and an export carries it. The store's upgrade to its version 3 stamps the rows of an
  earlier version by that rule (`stampSaveRecords`, `src/data/saves/legacyRows.ts`),
  one row at a time, so that the rows of one party and data set are one playthrough;
  the page gives it a stream of its own to draw from (`src/main.ts`). The import is
  the other way in, by the same rule and from the same stream
  (`GameSaves.importSave`). So 0 is no special value to the game: a load takes the
  file's id as it is, as CSBWin does (`doc/CSBwin-src/SaveGame.cpp:1734`), and the
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
  there, under the row's key and name, and the first press makes the row. **The
  Sleepsave is a slot of its own** beside it ("The Sleepsave"). **F9 loads the
  playthrough's newest save**, either slot or another, and finds none in a playthrough
  not saved yet, a new game's. Both are the player's, not debug features,
  and what they did is printed in the message area ("The two keys").
- **SAVE writes over the selected save**, or makes a new one from the heading of the
  running game's playthrough; a game with no save yet has no heading, and makes its
  first from the list's "new save" row. The row written over keeps its key and its name
  and takes the file, its date and the game's playthrough, and is the dialog's save from
  then on: a quick-save written over is F5's slot no longer, and the next F5 makes
  another, and the same for the Sleepsave. On another playthrough's heading SAVE does nothing, the author's decision: a
  file holds the running game's id, so a new save is never another playthrough's.
  **LOAD takes any save**, and from a heading the last save used of its playthrough.
  Either asks first when the save, the one read or the one written over, is of another
  playthrough than the running game's; the order of two saves of one playthrough is
  never checked, since loading an old save and saving over a newer one is ordinary
  play. The question is `_DoMenu`'s two-option menu in the
  dialog's place: CSBWin's own line for a save of another `d.RandomGameID`, "THAT'S NOT
  THE SAME GAME" (`doc/CSBwin-src/SaveGame.cpp:1730-1731`), over the action and CANCEL
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
  repeating its middle (`drawPiece`, the dialogs' widget kit, `src/renderer/ui/Widgets.ts`):
  the grey frame, the sunken panel and a button frame. Two panels
  side by side, the list's (210 wide: 32 characters a row and the scrollbar) and
  the preview's (65 wide, 10 characters), over one row of four buttons: LOAD, SAVE and
  EXPORT under the list, CLOSE under the preview. A button that can do nothing has no
  label, as CSBWin's empty slot has none. The labels' places in their frames, the
  rectangle a click takes and the press animation are `_DoMenu`'s. The question before
  a load or a save is `_DoMenu`'s centred menu, alone on the cleared screen.
- **A two-level list**: a heading for each playthrough, named by the champions of its
  newest save, and under it, folded or not, its saves, newest first, each with its day,
  its time, its level and, on F5's, "QUICKSAVE", on the Sleepsave "SLEEPSAVE"
  (`layoutRows`). The playthroughs are in
  the order of their last
  use, a playthrough's being that of the save of its own last used
  (`playthroughsOf`, `src/data/saves/SaveStore.ts`). The dialog opens with the first
  unfolded, the last save used selected under it, and the others folded; a click on a
  heading folds or unfolds it, and so do the left and right arrows. A game with no save
  yet has no heading, and the full menu a first row, "NEW SAVE", in its place.
- **The list scrolls** under its fifteen rows, which fill its panel with two pixels of
  it above and below, beside a scrollbar in the manner of a
  GEM window's, in the dialog's two colours, the option's orange on the panel's brown
  (`drawList`, `src/renderer/ui/Widgets.ts`): eleven columns against the panel's
  right edge, outlined; a hollow arrow on a stem in a box at each end; between them a
  slider, plain, whose height is to the track's as the rows shown are to the list's,
  in a track dithered of the two colours where rows lie beyond the panel. A list that
  fits has the whole track for a slider. A click on an arrow scrolls a row, and a notch
  of the wheel three, a touchpad's small deltas added up (`Widgets.wheelRows`); the
  slider is not dragged, and the track takes no click. Scrolling
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
- **The import's hint**, "DROP .DAT TO IMPORT", is in the message's place while there is
  none and the pointer is on the preview's panel or EXPORT's frame, labelled or not
  (`SAVE_MENU_IMPORT_HINT`, `src/renderer/ui/SaveMenu.ts`): two lines, the two under a
  full preview's thirteen, so it covers none of it. Nothing else on the dialog says a
  dropped file is imported, and a hint always up would be in the way. In play, the
  VBL's frame a pointer move asks for draws it; at the entrance, whose chooser no VBL
  draws again, the move that brings it up or takes it down redraws the chooser
  (`GameScreen.moveDialogPointer`). RISE's dialog, which imports nothing, has no hint.
- **LOAD, SAVE, EXPORT**, DELETE in EXPORT's place, and a drop for the import. No quit
  and no "SAVE AND QUIT": loading another playthrough's save is how a player leaves a game. **A dropped
  save of the dungeon is listed at once**, selected, under "SAVE IMPORTED", and nothing
  is loaded (`saveMenuDrop`, `src/renderer/ui/SaveMenu.ts`). The dialog takes no drop
  while it is working, pressing a button or asking. What is not stored is said in
  `_DoMenu`'s centred menu in the dialog's place (`importMenu`): the question for a
  slightly different dungeon, "IT SEEMS THIS SAVE IS FOR A SLIGHTLY DIFFERENT DUNGEON",
  over LOOK FOR A BETTER MATCH, IMPORT ANYWAY and CANCEL, whose first option may bring up
  the refusal that follows; and under OK alone, "THIS LOOKS LIKE A SAVE OF" the other
  dungeon, with "SWITCH TO IT TO IMPORT IT" or, for a dungeon no data set
  plays, "NOT SUPPORTED YET", or "THIS IS A SAVE OF AN UNKNOWN DUNGEON". Esc and a
  right-click dismiss either. A file that is no save, or does not read, is the dialog's
  message.
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
- **DELETE is behind a long press**, so that nothing deletes a save by accident: a press
  held half a second on a save's row (`SAVE_MENU_LONG_PRESS_MS`, released early or
  moved off the row it is a click), or Delete or Backspace on a save selected, turns
  EXPORT into DELETE for that save (`deleteArmed`, `src/renderer/ui/SaveMenu.ts`).
  Another selection turns it back, as does the list read again after a save, an import
  or the delete; the import's hint is not shown over it. DELETE always asks, in
  `_DoMenu`'s centred menu in the dialog's place: "DELETE THIS SAVE?" over the save's
  row, with DELETE and CANCEL; Esc and a right-click cancel. Confirmed, the row is gone
  from the store (`GameSaves.remove`, through `UIState.onDeleteSave`), the save after
  it in its playthrough is selected, or else the one before, or the row in its
  heading's place when it was the playthrough's last, and the dialog says "SAVE
  DELETED". The game is left alone, whichever save it came from: F5 then writes a new
  quick-save, and F9 loads the playthrough's newest save left. The load-only chooser
  has it; RISE's dialog, with no EXPORT, has none.
- **CLOSE, Esc and a right-click close it.** CLOSE undoes nothing, so it is not called
  CANCEL; the questions' CANCEL is theirs. None of them does while the dialog works (a
  save, a load, a list or an import under way): the game would play on under it.
- **While a DSA has disabled saves** (`&DISABLESAVES`, `DsaSystem.disableSaves`), CSBWin's
  disk menu is only "SAVES ARE DISABLED" and OK (`doc/CSBwin-src/SaveGame.cpp:856-873`),
  since it did nothing but save. The dialog loads and exports too, so it opens as ever,
  with that line as its message, and saves nothing: SAVE has no label anywhere, and
  there is no "NEW SAVE" (`savesDisabled`, `src/renderer/ui/SaveMenu.ts`).
- **The same dialog at the entrance and in play**: the chooser takes the clicks, the
  wheel and the keys the disk menu takes, less SAVE and the question. The wheel and the
  keys reach the list in play and at the entrance, whose chooser is up before play has
  the input: the entrance's host holds it then (`createIntroHost`,
  `src/renderer/intro/BootSequence.ts`, through `GameInput.take`).
- **No "GAME LOADED, READY TO PLAY."**, nor its "ASCII DUMP" (`DEBT.md` G14): a
  loaded game is played at once. It is CSBWin's `_TAG021028` menu
  (`doc/CSBwin-src/CSBCode.cpp:10617-10661`), so its absence is an entry of
  `doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port". The boot's
  hand-off keeps the fade to black and the cleared screen that menu gave the chooser's
  picture (`tag021028`, `src/renderer/intro/BootSequence.ts`).

## The two keys

F5 writes its playthrough's quick-save, over the last, and F9 loads the newest save of
its playthrough, F5's or the dialog's ("A playthrough"). Each key says what it did on a
line of the message area, in white (`GameSaves.tell`; `doc/CSBWIN_MESSAGES_REFERENCE.md`):
"GAME SAVED" or "GAME LOADED"; "CANNOT SAVE NOW" with no party, with a champion still
being chosen, while a script holds the loop, or while the party slides in a gravity
dungeon (`doc/3D2D1D.md`), and "CANNOT LOAD NOW" while a script holds the loop or a
champion is still being chosen, asked again once the store has answered, so neither a
script nor a mirror clicked while it read meets the loaded world;
CSBWin's disk menu's "SAVES ARE DISABLED" (`doc/CSBwin-src/SaveGame.cpp:856-873`) while a
DSA has disabled saves (`&DISABLESAVES`);
CSBWin's own "UNABLE TO SAVE GAME!" (`doc/CSBwin-src/SaveGame.cpp:1363`) and "CAN'T FIND
SAVED GAME!" (`:1710`) for a write that failed and for no save at all; a file that does
not read gives the line the dialog's message would be. Each outcome is also a line for
the console, with the save's name, and with the error behind a failure.

A game an error has ended (`Game.die`, the page's "The game has stopped.") saves nothing,
by either key, the dialog or the Sleepsave (`GameSaves.save`): the error may have left
the world half-updated, and F5 would write it over the quick save that F9 reads after the
reload the message asks for. The page takes no key of it either (`GameInput`), so F5 and
F9 are the browser's again: a reload. `tools/checks/fatal-error.ts` holds both.

A save read in play, F9's, LOAD's or the prison's new adventure, has no CSBWin
counterpart: CSBWin reads a game only after `d.Initialize()` has zeroed the whole of `d`
(`doc/CSBwin-src/CSBCode.cpp:333-340`). So the screen's share of `d` is a new game's once
the read is in, before anything runs on it (`GameHost.savedGameRead`): an open chest is
dropped, never repacked into the world read, an open inventory closed, its video mode the
adventure's again, and the attack menu, the Reincarnate screen, the eye and the mouth are
gone. The loop's share starts clean too (`Game.installReadState`): no script holds it, and
the clicks and keys queued before the read are gone, as both CSBWin's reads, at the boot
and at the restart, end in `DiscardAllInput`. The disk menu's `TAG0207cc` then runs on the
party read.

A read is whole or nothing (`readGame`, `src/engine/ReadGame.ts`). It builds the world,
the state and everything else it installs off the running game, then installs them in one
step that cannot fail, then starts the game read: the overlay, the party's level loaded,
the databases thinned. A file that fails while the read builds is the line or the
dialog's message above, and the game played on is the one that was running, untouched. A
failure once the read is in ends the game, `die(0xbad)` with "SAVED GAME DAMAGED!" and the
reason, rather than play on in a game half read. Before it builds, a save is held against
its world (`validateCsbwinWorld`, `src/engine/CsbwinSaveGame.ts`): the party's level and
square inside the dungeon, at most four champions, the hand and the caster among them,
the object in hand a record, the timers inside their table; one outside is refused as a
file that fails while the read builds, where CSBWin plays on into memory past its arrays
(`DEBT.md` H). `tools/checks/damaged-read.ts` holds all three.

## CONTINUE

The welcome page's CONTINUE (`src/ui/welcomePage.ts`) opens the game's page with the
last save used in its query, `?dungeon=<id>&save=<row id>`, and the boot reads that row
into the game as F9 reads one (`continueSave`, `src/main.ts`): straight into play, with
neither the FTL logo, the title nor the entrance, and the row the last save used. A row
that is not the set's, or is not in the store, or whose file does not read, leaves the
entrance, without the logo and the title, and the console says why.

## The Sleepsave

The port's own, as F5 is: a slot of each playthrough, apart from F5's and found the same
way (`slotOf`, `src/data/saves/SaveStore.ts`), written when the party lies down and
written over when the player wakes it (`GameSaves.sleepSave`). Both are player's clicks,
the sleep icon, button 145, and the click that wakes, button 146, and each raises
`UIState.sleepSaveNeeded`, which the screen acts on once the click is drained, as on the
disk icon's flag (`GameScreen.handleMouseButton`). A blow that wakes the party
(`WakeUp` from `doc/CSBwin-src/Monster.cpp:4544` and `Character.cpp:2816`) raises
nothing, so the slot keeps the moment the party lay down. The author's decision: lying
down is always the player's choice, but not always a safe place, so the slot never
touches F5's or a dialog's save.

- **Silent.** It says nothing in the message area, written, refused or failed: what it
  did is a line for the console alone.
- **Refused where F5 is**, with no party, with a champion being chosen, while a script
  holds the loop and while a DSA has disabled saves, and in CSB's prison, where a save
  asks "BEGIN THE ADVENTURE?" (`GameSaves.inPrison`).
- **Saved as F5 saves**, the clock running. A party lying down has closed the inventory
  first, and `d.PartySleeping` is in no file, so a load of either save is of a party
  awake.

## What the dialog leaves out

None of these was in the dialog's scope, and none is debt:

- **No file picker** for an import: the drop is the one way in.
- **No "SAVE AND QUIT"** (`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in
  this port").

An unknown dungeon played from its save is `DEBT.md` G22.

## Evidence

`tools/checks/save-menu.ts` drives `GameSaves` and the dialog over a store in memory; its
sections are named below. Node has no IndexedDB, so no tool runs `BrowserSaveStore`
itself: neither the IndexedDB half of the upgrades (`upgradeRows`) nor
`BrowserSaveStore.markUsed`, nor `BrowserDataSetStore`. `tools/probe-frames.ts` checks
in a browser the store held by another tab, both ways; the upgrade from version 5, a
row's file moved to `saveFiles` byte for byte; a list reading no file, an import and a
DELETE writing and deleting a row and its file together, and a local data set deleted
with its saves' rows and files.

- **RISE**: `tools/checks/rise.ts` (the row a new adventure is stored as, again, and a
  refusal; the chooser's `rise` mode over every set's saves, its LOAD and a refusal, and
  `tools/checks/save-menu.ts` its title, its eleven rows, RISE, no EXPORT, no drop taken
  and no hint, and NEW FACE: what it reads, a click, what LOAD passes on; the
  portraits a DM party is raised with, a renamed champion's, and the prison's kept; the
  prison's question: which game is the prison, four champions recruited at its mirrors
  of whom only the fourth asks, the prison's save taken by the utility, F5's question,
  YES and NOT YET in a dialog raised alone and over the disk menu's SAVE, and no question
  outside the prison).
- **The row and the store's upgrades**: "the one save call" and "the store's upgrade"
  (version-1 rows through both upgrades; which rows join a named save and which draw, in
  either order of the rows; each row's file holding the row's id; a stamped file being
  byte for byte the file the game writes under that id, and loading; a row's draw held
  to its own data set's rows; a version-1 row that holds no CSBWin file dropped, and a
  later row the later steps cannot read kept; each step run from the versions before
  its own alone, a file imported since left as it is; an upgraded row
  counting no play time; a file holding the four `GAMEBLOCK1` words at 0 refused by
  RISE, then stamped into the file the game writes with CSBWin's, taken by RISE, and
  loading with them; a file that holds one of them left as it is).
- **The stamp**: `tools/checks/save-stamp.ts`, over the eight genuine saves and the two of
  `tools/fixtures/gamefiles/csb`. The stamped file differs in six bytes of `GAMEBLOCK1`, the id
  and the word the block's fold ends on; it reads back with the id, the level and the
  party; its own id stamped back gives the file byte for byte; a CSBWin block stamped is
  what `ScrambleAndWrite` writes, and `mini.dat`'s 127 fold words that are not zero are
  kept. No genuine save holds the four `GAMEBLOCK1` words at 0, and one that holds
  CSBWin's 1, 2, 1 and 13 stamped with them is the file byte for byte.
- **The playthrough a file that names none joins**: "the list" (which save is joined).
- **F5's slot and F9's choice**: "the list" (which row is the slot), "the one save call"
  (a second F5 writes over the first, and SAVE does not) and "one store, two data sets"
  (F9 in its playthrough, and in one with no save).
- **A read in play leaves the old world**: "a save read in play over an open chest and an
  open inventory" (F9 and LOAD, with an object taken from an open chest into the hand: the
  chest read whole, no inventory open, the attack menu, the Reincarnate screen and the eye
  gone).
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
  selection" (CLOSE, the arrows).
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
- **The Sleepsave**: `tools/checks/sleep-save.ts` (the slot found apart from F5's, per
  playthrough and data set; the "SLEEPSAVE" row; a stored row from before the flag; two
  Sleepsaves one row; F5 and the Sleepsave never writing over each other; F9 loading it
  when newest; SAVE over it making it the dialog's; nothing in the message area; each
  refusal, and a failed write, a line for the console; buttons 145 and 146 asking for it,
  a blow's `WakeUp` and a refused sleep not).
- **EXPORT**: "EXPORT" (no label and no click on a heading, and on "NEW SAVE" in "the
  menu's selection"; on a save, the press, then one file under the row's name, the
  store's bytes byte for byte, which read as a CSBWin save; no row written and the game
  left alone; another playthrough's save without a question; a read that fails; the
  load-only chooser).
- **DELETE**: "DELETE" (a click, a press moved off its row, a long press on a heading and
  Delete there leaving EXPORT; the long press turning it into DELETE, labelled, a click
  on the same save keeping it and another selection turning it back; Delete, Backspace
  and the arrows; the question, its CANCEL and Esc deleting nothing; the row and its
  file gone, the menu up under "SAVE DELETED", the save after it selected, then the one
  before, and the row in a heading's place, the game left alone; the load-only chooser
  deleting, and RISE's dialog having no DELETE).
- **A dungeon's signature, and the catalogue**: `tools/checks/dungeon-signature.ts` (the
  digest's input on a level made by hand, and the digest against `node:crypto`'s; every
  data set's `dungeon.dat` and CSB's `mini.dat` a catalogue dungeon that lists the set,
  whole, no entry without its file and no digest listed twice; the eight genuine saves,
  from `d.Time` 70 to 127290, and the two of `tools/fixtures/gamefiles/csb`, each its own
  dungeon's and matching no level of another; the port's own save; on the late save's
  world, a cell's attributes, objects and type among those not stone changing nothing, a
  wall opened or a cell walled changing its level's digest alone, the size in the
  digest, and a save of thirteen levels of the fourteen being most of Dungeon Master and
  not the whole; `checkDungeon` in each of the Dungeon Master sets and in `csb`
  against their own files, thirteen levels the same of fourteen being a slightly
  different dungeon, the same shapes and no digest the same another, a level turned or
  a level fewer going on to the other sets, which never name the set's own, LOOK FOR A
  BETTER MATCH, a set whose `dungeon.dat` does not read, a known dungeon no data set
  plays, and a set the catalogue does not list, holding Dungeon Master or most of it;
  and Dungeon Master 1.0 and Dungeon Master, each in a set of the other).
- **The import**: "the import" (a genuine save stored under its file's name, date and
  playthrough, byte for byte, and again under a numbered name; a file that names no
  playthrough joined to its party's or given the first its stream draws, stamped, the
  game's stream left alone; a save with one wall opened a slightly different dungeon,
  unknown to the other sets, and stored only on IMPORT ANYWAY, unofficial, and the saves
  of a game read from it unofficial too, SAVE's and F5's, but not a new game's nor one
  written over the row by another game; a Chaos Strikes Back save, a save with a wall of
  every level opened, and four files that do not read, none stored; the `csb` set taking
  its two saves and refusing Dungeon Master's; a set the catalogue does not list taking a
  save of its `dungeon.dat`; and a local set read through its record, under the same
  rules, the slightly different save Dungeon Master's among the other sets).
- **The drop and the dialog's answers**: "the drop" (every menu a drop brings up within
  the title panel's four lines of 33 characters, and each option narrower than its
  button; no drop taken with no dialog up; a genuine save listed, selected and previewed
  under "SAVE IMPORTED", nothing loaded; a save with one wall opened asked about, the
  screen `_DoMenu`'s own drawing of the three-option question, which a click off its
  buttons, Enter, the wheel and another drop leave up, CANCEL, Esc and a right-click take
  down with nothing stored, LOOK FOR A BETTER MATCH answers with the unknown dungeon's
  refusal, and IMPORT ANYWAY with an unofficial row; in a local set, LOOK FOR A BETTER
  MATCH naming Dungeon Master; a Chaos Strikes Back save and one of an unknown dungeon
  refused under OK; a text file as the dialog's message; no drop taken during a press;
  the load-only chooser importing a genuine save, which LOAD then plays).
- **No "GAME LOADED, READY TO PLAY."**: `tools/checks/bad-saved-game.ts`, "a save read"
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
`checks/save-menu.ts` proves the rows.
