# UI module map

Where the DM user interface lives, and which CSBWin file each module is a translation of.
Keeping the names aligned with the C++ is what makes the two codebases greppable against
each other.

## The shared state

`src/renderer/ui/UIState.ts` — CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`,
`Character.cpp` and `Magic.cpp` all reach into. Here it is one object that
`ScreenComposer` owns and every UI function takes as its first argument. `createUIState`
builds it whole, from its data sources and every hook, so none of them is ever missing:

- **data sources**: `graphicsLoader`, `ctx` (the game's `GameContext`, CSBWin's `d.`:
  the dungeon, the party and the systems), `context` (the viewport's bytecode interpreter
  context), `screenIndexBuffer`, `uiTables`, `objectTables`, `fontData`, `partyState` (the
  game's party, `ctx.party.state`, read through), `uiMode`
- **interaction state**: `hoverPoint`, what the attack menu drew, the chew-animation
  clock, the two button lists, `reincarnate` (non-null while the name-entry screen is
  modal). The `d.` fields the engine reads too, the held eye and mouth, the open chest
  and the attack menu (`attackingCharacterOrdinal`, `possibleAttackTypes`, …), are the
  context's, `ctx.interface` (`src/engine/InterfaceState.ts`)
- **graphics**: `graphics`, the `GraphicsStore` the interface shares with the viewport
  (`src/renderer/GraphicsStore.ts`), cursor bitmaps, the portrait sheet
- **hooks out to the page** (`ScreenHooks`): the save menu's three (`onSaveGame`,
  `onRestoreSave`, `onRestoreFailed`, which the page points at `GameSaves`), and `onReincarnated`, the page's
  redraw once the name-entry screen is answered. Everything the interface does to the
  game it does as CSBWin's does to `d.`, through `ctx`: the systems (casting, attacking,
  the Hall of Champions, the possessions), `LoopState` (a script holding the loop, the
  button flashes, sleep and freeze) and the dungeon's records
- **hooks back into the renderer**: `getGraphicBitmap`, `renderLastFrame`

A function that turns out not to need the state does not take it — the pure helpers
(`formatLoad`, `testThrow`, `searchButtonList`, …) have plain signatures.

## The modules

| Module | CSBWin counterpart | Holds |
| --- | --- | --- |
| `ui/Mouse.ts` | `Mouse.cpp` | The button search a click is queued by, the `word0` button dispatcher (including its `PotentialCharacterOrdinal` gates), clothing/party/inventory click handlers, `tag01a6ea` for the eye panel, `TAG02076e` and `TAG0207cc`, the way in and out of the disk menu, the freeze, sleep and the Hall of Champions menu, button 80's `HandleClickInViewport`, and the cursor |
| `ui/Keyboard.ts` | `CSBUI.cpp` (`KEYXLATE`, `UIM_KEYDOWN`) | The panel key bindings — attack menus, attack options, inventories, runes, cast, caster. CSBWin has no keys of its own: `config.txt` binds a scancode to a screen point and a mouse button, and `UIM_KEYDOWN` clicks there. This binds the handlers those clicks reach. Also the port's own keys outside the panels: K , J L M . to move, F5 and F9 to quick-save and quick-load (`portKeyAction`) |
| `ui/HitTest.ts` | `Mouse.cpp` | `searchButtonList` — the leaf both Mouse and the panels depend on |
| `ui/ReIncarnate.ts` | `Code13ea4.cpp` | The name-entry screen a reincarnated champion gets: the two fields, the letter grid, and the duplicate-name rule. The one **modal** screen in the UI — while `ui.reincarnate` is set, `GameInput` (`src/renderer/GameInput.ts`) hands it every click and every key |
| `ui/Menu.ts` | `Menu.cpp` | `_DoMenu` and `_WaitForMenuSelect`: graphic 0, the four option layouts and their self-blits, `CenteredText`/`SplitLongLine`, the 210-213 button sets and the two-pass press animation. See `doc/CSBWIN_MENU_REFERENCE.md` |
| `ui/SaveMenu.ts` | `SaveGame.cpp` (`_DisplayDiskMenu`), extended | The save/load screen behind the disk icon. A dialog over the whole screen, drawn from the widget kit (`Widgets.ts`) and keeping `_DoMenu`'s animation, which replaces the four-slot chooser with a scrolling list over `src/data/saves/`. **Modal** like `ReIncarnate.ts`: it is the dialog over the game (`Dialog.ts`), and clicks reach it straight from the DOM event, not through the mouse queue |
| `ui/Dialog.ts` | — (the port's own, from `Menu.cpp`'s `_WaitForMenuSelect`) | The one dialog slot over the game (`UIState.dialog`): what is up gets every click, key, notch of the wheel and drag, is drawn over the composed screen, and holds the clock (`ctx.state.paused`). The save menu, the settings, the map and the champions fill it |
| `ui/Widgets.ts` | — (the port's own, from `Menu.cpp`'s art) | The dialogs' widget kit, cut from graphic 0 and drawn in the UI palette, as the design canvas's kit draws it (`DEBT.md` → "U"): the plate, the panel, the button (raised, hovered, pressed, dim, inert; at graphic 0's height or a low one), a list with its scrollbar, a tabbed page (an outline etched in the plate, its tabs over it, the selected one open into it), a toggle, a slider, the help line and a line of text. Each gives its own button list. The save menu and the settings dialog are drawn through it, and `tools/checks/widgets.ts` checks what the save menu does not use |
| `ui/SettingsDialog.ts` | — (the port's own) | The player's settings (`src/settings/Settings.ts`) as the dialog over the game, its whole screen: a title line with CLOSE and EXIT, a tabbed page (GAME, DISPLAY, SOUND, KEYS), on GAME and DISPLAY a button a setting holding its name, two a line, pressed when on, and on SOUND a line a setting with its toggle or slider, and a help line naming what the pointer is over. EXIT asks first, in `_DoMenu`'s two-option menu, then leaves for the welcome page (`UIState.onExit`). Esc or a double click on the message area opens it (`GameInput`); shown through the UI palette whole. `tools/checks/settings-dialog.ts` |
| `ui/MapDialog.ts` | — (the port's own) | A level as the dialog over the game, its whole screen: `<`, the level's number and the square under the pointer, `>`, the marks' toggles G, M and I (a cross on each square with a generator, monsters or an item, `CellInfo.marked`) and CLOSE; the map at the left, at the largest whole cell that fits, a colour a room type, its columns and rows numbered, the party a triangle facing its way; at the right, the info of the square shown (`engine/CellInfo.ts`), a list whose links show the squares they name. With MAP VIEW on, the MAP key or a long press on the message area opens it (`GameInput`); a click shows a square; a page opened with `?dev` moves the party by a press held on one (`UIState.onTeleport`). `tools/checks/map-dialog.ts`, `tools/checks/map-cell-info.ts` |
| `ui/ChampionDialog.ts` | — (the port's own) | The party's permanent numbers as the dialog over the game, its whole screen: a tabbed page of two tabs, CLOSE above it, and a table of four champion columns, the levels, maxima and attributes on ATTRIBUTES and the sixteen sub-skills on SKILLS, a level or sub-skill its mastery and a bar of its progress. With CHAMPION VIEW on, the CHAMPIONS key or a long press on a champion's stat bars opens it (`GameInput`), the long press marking that champion; a tap there is held back to its release, then queued as the inventory's click. `tools/checks/champion-dialog.ts` |
| `ui/SettingsKeys.ts` | — (the port's own) | The settings dialog's KEYS tab: the presets (CSBWIN, KEYPAD, ARROWS, and CUSTOM for a table changed by hand), KEY LABELS' QWERTY or AZERTY where the browser does not give the keyboard's layout, and a scrolled list, three rows a notch of the wheel, of every `KeyAction` with its two keys. A click on a slot waits for a key, which fills it and leaves every other slot (`bindKey`); a right click empties it. `tools/checks/settings-dialog.ts`, `tools/checks/key-bindings.ts` |
| `ui/RecordingStrip.ts` | — (the port's own) | A recording's viewer's strip while `?recording=` plays (`playRecording`, `src/main.ts`): over the message area's top row (`ScreenComposer.overlay`), whose lines are then drawn a row lower while its bottom row is empty, the time played and four controls in the menu's font, lit under the pointer: PAUSE or PLAY, the pace (×1, ×2, ×4, ×8, `Game.setPace`), RESTART and STOP; and their keys, Space, `+` and `-`, Backspace and Esc. RESTART puts the page back as a new page has it (`rewindPage`) and plays the path again. `tools/checks/replay.ts` (point 11), `tools/probe-frames.ts` |
| `ui/KeyLabels.ts` | — (the port's own) | A key's label in the game's font: what the keyboard prints on it, from the browser's layout map (`navigator.keyboard.getLayoutMap()`) or the QWERTY or AZERTY table, a character the font cannot draw named in letters. `tools/checks/key-bindings.ts` |
| `ui/Inventory.ts` | `CSBUI.cpp` | Inventory screen, slot rectangles, the open chest, the eye's object-info panel, scroll reading, the Hall of Champions menu (`TAG0189a8`) |
| `ui/Character.ts` | `Character.cpp` | Portraits, hand icons, shield dots, the damage figure over a hurt champion's name (`DisplayCharacterDamage`'s blit), life/stamina/mana bars, attributes, food/water, carried load, possession slots |
| `ui/Feeding.ts` | `Character.cpp` | The mouth button and the chew animation. Derives a `FEEDPARAMETERS` block (`_FeedCharacter`'s first half); `src/engine/Feeding.ts` applies it (`applyFeedParameters`) |
| `ui/MagicPanel.ts` | `Magic.cpp` (UI half) | Rune keypad, the incantation being assembled, its mana cost |
| `ui/Attack.ts` | `Character.cpp` (attack half), `CSBCode.cpp:8823-8967` | The attack buttons and the attack menu: legal options, the clicks, the panel's drawing and the damage flash. The menu's `d.` work, `TAG01b1c0`, `DrawLegalAttackTypes`'s names and `TAG01b29a`, is `src/engine/AttackMenu.ts` |
| `ui/Objects.ts` | `Objects.cpp`, `Code17818.cpp` | Name-index resolution, description phrases, weight, `DetermineMastery` |
| `ui/Draw.ts` | `CSBUI.cpp` | Screen-buffer primitives (`fillRect`, shading, object icons, bars) and the static chrome |
| `ui/ViewportPicking.ts` | `Mouse.cpp`, `Viewport.cpp` | What the point under the cursor refers to |

## The pre-game screens

`src/renderer/intro/` is a separate directory rather than another row above, because these
screens run before there is a party, a level or a main loop and they talk to the Atari
hardware directly — the logical screen base, the shifter's colour registers, the VBL counter,
the sound chip — and to nothing else. `IntroHost.ts` is that hardware as an interface;
`intro/BootSequence.ts` builds it over `GameScreen`'s composer. Spec:
`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`.

| Module | CSBWin counterpart | Holds |
| --- | --- | --- |
| `intro/IntroHost.ts` | the ST, and `Graphics.cpp` (`_FadeToPalette`) | The interface the screens draw through, the eight-step palette fade, `d.Palette11914` (black), and the Timer-A → sample-rate mapping |
| `intro/TitleSequence.ts` | `CSBCode.cpp:9308` (`_DisplayChaosStrikesBack`) | The title animation and `ShrinkBLT`'s 16.16 fixed point |
| `intro/PrisonDoor.ts` | `CSBCode.cpp:9577` / `:9667` / `:9485` / `:9753` | The dungeon entrance, its three buttons, the 31-frame door animation and the credits scroll |
| `intro/PrisonLevel.ts` | `CSBCode.cpp:9678-9698` | The synthetic 5×5 level behind the doors, as a `DungeonState` the real viewport renderer can read |
| `intro/BootSequence.ts` | `CSBCode.cpp:11573` (`_AskWhatToDo`) | The input queue, which holds the page's input while a screen has the canvas, the VBL clock and the order the screens run in |

## `GameScreen`, `ScreenComposer` and `ViewportRenderer`

`src/renderer/ScreenComposer.ts` is the screen composed, without the DOM. It owns the
`UIState`, the viewport and the screen's palette-index buffer, and takes the interface's
hooks out as one object at construction (`ScreenHooks`, as `GameHost` is the engine's).
`presentViewport()` composites every panel over the viewport and converts the palette
indices to RGBA through the UI palette and the light level's viewport palette, into an
image of `ImageData`'s shape (`RgbaImage`), which it hands to its `ScreenOutput`;
`presentScreen()` does the same for a pre-game screen's frame through the palette it is
given. The pre-game screens draw through the composer and `ui/` directly
(`intro/BootSequence.ts`): its screen buffer, its graphics, `presentScreen` and
`setBootFrameRenderer`, the interface's font and tables, and `ui/Menu.ts`'s menus.

`src/renderer/GameScreen.ts` is the screen on the page. It owns the canvas, puts each
frame its composer hands over on it, and keeps the pointer's state. Its methods are the
ones with work of their own: `handleMouseButton` opens what a button handled asked for
(the save menu, the Hint Oracle, the sleep's save), `drawViewport` and `refreshOverlay`
compose, `syncParty` and `initializePlayState` set the screen's state for a game, the
latter emptying the viewport's caches first. Nothing calls it to reach a UI module: the
input path, the pre-game screens and `main.ts` call the `ui/` modules on its `ui`.

`src/renderer/GameInput.ts` is the input path. The page's listeners (`src/ui/events.ts`)
hand it a screen point and a mouse button, or a key and its modifiers, and nothing else of
the DOM; it routes them to a dialog, a modal screen, the game's mouse queue, the panel
keys or the port's own keys, calling the `ui/` modules itself, and hands the game the
interface's dispatcher for the queued buttons (`install`). What it asks of the screen is
an `InputScreen`: its `ui`, and the pointer, a button's deferred flags and the wheel,
which the screen keeps. A tool that drives it gives one of those, typed, with a real
`UIState`. Nothing under `src/renderer/` imports `src/ui/`.

`src/renderer/ViewportRenderer.ts` is the dungeon view and only that: the interpreter
context and its tables, the wall / floor-ceiling / mirrored-bitmap caches, the viewport
palettes with the level's monster colour overrides, and `draw()`. `drawViewportFrame()` is
everything `DrawViewport` needs set up around it for one frame, taking the `DungeonState` as
a parameter, so the entrance screen can run the same renderer over `intro/PrisonLevel.ts`
(`renderPrisonInterior()`). The palette bookkeeping is `selectLevel()`, apart from `draw()`:
it belongs to the level the party is on, and runs while the party sleeps and the view is
not drawn.

## Picking is a reverse lookup, not a projection

Worth knowing before touching `ViewportPicking.ts`: the bytecode renderer records, for every
object and wall feature it blits, the screen rectangle it occupied plus the object's RN
(`viewportObjectButtons` / `viewportObjectRNs` of the frame's `ViewportPicking`, which
`ViewportRenderer.draw` returns and `GameScreen` keeps as `ui.picking`). A click is resolved
by scanning that frame's records — CSBWin does the same rather than projecting the click back into the
dungeon.

## Verifying a change here

`tools/check-frames.sh` compares thirty live screen states, pixel by pixel, against
`tools/frames/`, and starts its own dev server and headless Chrome (`CLAUDE.md` → "Tech
stack" lists what its probe asserts besides). Throwing, dropping, chests, feeding and
casting are not among the frames.
