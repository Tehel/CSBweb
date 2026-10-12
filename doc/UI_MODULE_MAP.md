# UI module map

Where the DM user interface lives, and which CSBWin file each module is a translation of.
Keeping the names aligned with the C++ is what makes the two codebases greppable against
each other.

## The shared state

`src/renderer/ui/UIState.ts` — CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`,
`Character.cpp` and `Magic.cpp` all reach into. Here it is one object that
`GameScreen` owns and every UI function takes as its first argument. `createUIState`
builds it whole, from its data sources and every hook, so none of them is ever missing:

- **data sources**: `graphicsLoader`, `ctx` (the game's `GameContext`, CSBWin's `d.`:
  the dungeon, the party and the systems), `context` (the viewport's bytecode interpreter
  context), `screenIndexBuffer`, `uiTables`, `objectTables`, `fontData`, `partyState` (the
  party the screen last drew, `ctx.party.state` until then), `uiMode`
- **interaction state**: `pressingEye`, `hoverPoint`, the attack menu
  (`attackingCharacterOrdinal`, `possibleAttackTypes`, …), the open chest,
  the chew-animation clock, the two button lists, `reincarnate` (non-null while the
  name-entry screen is modal)
- **bitmap caches**: `graphicCache`, cursor bitmaps, the portrait sheet
- **hooks out to the page** (`GameScreenHooks`): the save menu's three (`onSaveGame`,
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
| `ui/HitTest.ts` | `Mouse.cpp` | `searchButtonList`, `pointInRect` — the leaf both Mouse and the panels depend on |
| `ui/ReIncarnate.ts` | `Code13ea4.cpp` | The name-entry screen a reincarnated champion gets: the two fields, the letter grid, and the duplicate-name rule. The one **modal** screen in the UI — while `ui.reincarnate` is set, `GameInput` (`src/renderer/GameInput.ts`) hands it every click and every key |
| `ui/Menu.ts` | `Menu.cpp` | `_DoMenu` and `_WaitForMenuSelect`: graphic 0, the four option layouts and their self-blits, `CenteredText`/`SplitLongLine`, the 210-213 button sets and the two-pass press animation. See `doc/CSBWIN_MENU_REFERENCE.md` |
| `ui/SaveMenu.ts` | `SaveGame.cpp` (`_DisplayDiskMenu`), extended | The save/load screen behind the disk icon. A dialog over the whole screen, drawn from the widget kit (`Widgets.ts`) and keeping `_DoMenu`'s animation, which replaces the four-slot chooser with a scrolling list over `src/data/saves/`. **Modal** like `ReIncarnate.ts`: it is the dialog over the game (`Dialog.ts`), and clicks reach it straight from the DOM event, not through the mouse queue |
| `ui/Dialog.ts` | — (the port's own, from `Menu.cpp`'s `_WaitForMenuSelect`) | The one dialog slot over the game (`UIState.dialog`): what is up gets every click, key, notch of the wheel and drag, is drawn over the composed screen, and holds the clock (`ctx.state.paused`). The save menu, the settings, the map and the champions fill it |
| `ui/Widgets.ts` | — (the port's own, from `Menu.cpp`'s art) | The dialogs' widget kit, cut from graphic 0 and drawn in the UI palette, as the design canvas's kit draws it (`DEBT.md` → "U"): the plate, the panel, the button (raised, hovered, pressed, dim, inert; at graphic 0's height or a low one), a list with its scrollbar, a tabbed page (an outline etched in the plate, its tabs over it, the selected one open into it), a toggle, a slider, the help line and a line of text. Each gives its own button list. The save menu and the settings dialog are drawn through it, and `tools/dump-widgets.ts` checks what the save menu does not use |
| `ui/SettingsDialog.ts` | — (the port's own) | The player's settings (`src/settings/Settings.ts`) as the dialog over the game, its whole screen: a title line with CLOSE and EXIT, a tabbed page (GAME, DISPLAY, SOUND, KEYS), on GAME and DISPLAY a button a setting holding its name, two a line, pressed when on, and on SOUND a line a setting with its toggle or slider, and a help line naming what the pointer is over. EXIT asks first, in `_DoMenu`'s two-option menu, then leaves for the welcome page (`UIState.onExit`). Esc or a double click on the message area opens it (`GameInput`); shown through the UI palette whole. `tools/dump-settings-dialog.ts` |
| `ui/MapDialog.ts` | — (the port's own) | The party's level as the dialog over the game, its whole screen: the level's number and CLOSE, and the map at the largest whole cell that fits, a colour a room type, the party a triangle facing its way. With MAP VIEW on, the MAP key or a long press on the message area opens it (`GameInput`); a page opened with `?dev` moves the party by a click on a square (`UIState.onTeleport`). `tools/dump-map-dialog.ts` |
| `ui/ChampionDialog.ts` | — (the port's own) | The party's permanent numbers as the dialog over the game, its whole screen: a tabbed page of two tabs, CLOSE above it, and a table of four champion columns, the levels, maxima and attributes on ATTRIBUTES and the sixteen sub-skills on SKILLS, a level or sub-skill its mastery and a bar of its progress. With CHAMPION VIEW on, the CHAMPIONS key or a long press on a champion's stat bars opens it (`GameInput`), the long press marking that champion; a tap there is held back to its release, then queued as the inventory's click. `tools/dump-champion-dialog.ts` |
| `ui/SettingsKeys.ts` | — (the port's own) | The settings dialog's KEYS tab: the presets (CSBWIN, KEYPAD, ARROWS, and CUSTOM for a table changed by hand), KEY LABELS' QWERTY or AZERTY where the browser does not give the keyboard's layout, and a scrolled list, three rows a notch of the wheel, of every `KeyAction` with its two keys. A click on a slot waits for a key, which fills it and leaves every other slot (`bindKey`); a right click empties it. `tools/dump-settings-dialog.ts`, `tools/dump-key-bindings.ts` |
| `ui/KeyLabels.ts` | — (the port's own) | A key's label in the game's font: what the keyboard prints on it, from the browser's layout map (`navigator.keyboard.getLayoutMap()`) or the QWERTY or AZERTY table, a character the font cannot draw named in letters. `tools/dump-key-bindings.ts` |
| `ui/Inventory.ts` | `CSBUI.cpp` | Inventory screen, slot rectangles, the open chest, the eye's object-info panel, scroll reading, the Hall of Champions menu (`TAG0189a8`) |
| `ui/Character.ts` | `Character.cpp` | Portraits, hand icons, shield dots, the damage figure over a hurt champion's name (`DisplayCharacterDamage`'s blit), life/stamina/mana bars, attributes, food/water, carried load, possession slots |
| `ui/Feeding.ts` | `Character.cpp` | The mouth button and the chew animation. Derives a `FEEDPARAMETERS` block (`_FeedCharacter`'s first half); `src/engine/Feeding.ts` applies it (`applyFeedParameters`) |
| `ui/MagicPanel.ts` | `Magic.cpp` (UI half) | Rune keypad, the incantation being assembled, its mana cost |
| `ui/Attack.ts` | `Character.cpp` (attack half), `CSBCode.cpp:8823-8967` | The attack buttons and the attack menu: legal options, the per-tick panel state, the damage flash |
| `ui/Objects.ts` | `Objects.cpp`, `Code17818.cpp` | Name-index resolution, description phrases, weight, `DetermineMastery` |
| `ui/Draw.ts` | `CSBUI.cpp` | Screen-buffer primitives (`fillRect`, shading, object icons, bars) and the static chrome |
| `ui/ViewportPicking.ts` | `Mouse.cpp`, `Viewport.cpp` | What the point under the cursor refers to |

## The pre-game screens

`src/renderer/intro/` is a separate directory rather than another row above, because these
screens run before there is a party, a level or a main loop and they talk to the Atari
hardware directly — the logical screen base, the shifter's colour registers, the VBL counter,
the sound chip — and to nothing else. `IntroHost.ts` is that hardware as an interface;
`intro/BootSequence.ts` builds it over `GameScreen`. Spec:
`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`.

| Module | CSBWin counterpart | Holds |
| --- | --- | --- |
| `intro/IntroHost.ts` | the ST, and `Graphics.cpp` (`_FadeToPalette`) | The interface the screens draw through, the eight-step palette fade, `d.Palette11914` (black), and the Timer-A → sample-rate mapping |
| `intro/TitleSequence.ts` | `CSBCode.cpp:9308` (`_DisplayChaosStrikesBack`) | The title animation and `ShrinkBLT`'s 16.16 fixed point |
| `intro/PrisonDoor.ts` | `CSBCode.cpp:9577` / `:9667` / `:9485` / `:9753` | The dungeon entrance, its three buttons, the 31-frame door animation and the credits scroll |
| `intro/PrisonLevel.ts` | `CSBCode.cpp:9678-9698` | The synthetic 5×5 level behind the doors, as a `DungeonState` the real viewport renderer can read |
| `intro/BootSequence.ts` | `CSBCode.cpp:11573` (`_AskWhatToDo`) | The input queue, the VBL clock and the order the screens run in |

## `GameScreen` and `ViewportRenderer`

`src/renderer/GameScreen.ts` is the screen. It owns the canvas and the `UIState`, and takes
the interface's hooks out as one object at construction (`GameScreenHooks`, as `GameHost` is
the engine's). `presentViewport()` composites every panel over the viewport and converts the
palette indices to RGBA through the UI palette and the light level's viewport palette. It
also hosts the save menu and the Reincarnate screen. Its public methods —
`searchMouseButtons`, `handleMouseButton`, `translateKey`, `handleUIKey`, … — are thin
wrappers, because the input path and `main.ts` call the screen, not the UI modules. They
delegate and do nothing else.

`src/renderer/GameInput.ts` is the input path. The page's listeners (`src/ui/events.ts`)
hand it a screen point and a mouse button, or a key and its modifiers, and nothing else of
the DOM; it routes them to a modal screen, to the game's mouse queue, to the panel keys or
to the port's own keys, and hands the game the screen's dispatcher for the queued buttons
(`install`). Nothing under `src/renderer/` imports `src/ui/`.

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
(`context.viewportObjectButtons` / `viewportObjectRNs`). A click is resolved by scanning
that frame's records — CSBWin does the same rather than projecting the click back into the
dungeon.

## Verifying a change here

`tools/check-frames.sh` compares nine live screen states, pixel by pixel, against
`tools/frames/`.
See the header of `tools/probe-frames.mjs` for how to start the dev server and headless
Chrome it needs. It covers rendering plus the inventory open/select click path; throwing,
dropping, chests, feeding and casting are **not** exercised.
