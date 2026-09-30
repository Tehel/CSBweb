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
- **interaction state**: `pressingEye`, `hoverPoint`, `showAttackPanel`, the open chest,
  the chew-animation clock, the two button lists, `reincarnate` (non-null while the
  name-entry screen is modal)
- **bitmap caches**: `graphicCache`, cursor bitmaps, the portrait sheet
- **hooks out to the page** (`GameScreenHooks`): the save stores' four (`onCreateSave`,
  `onSaveWritten`, `onRestoreSave`, `onRestoreFailed`) and `onReincarnated`, the page's
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
| `ui/Mouse.ts` | `Mouse.cpp` | The button search a click is queued by, the `word0` button dispatcher (including its `PotentialCharacterOrdinal` gates), clothing/party/inventory click handlers, `tag01a6ea` for the eye panel, `TAG02076e` and `TAG0207cc`, the way in and out of the disk menu, the freeze, sleep and the Hall of Champions menu, the cursor and hover highlights |
| `ui/Keyboard.ts` | `CSBUI.cpp` (`KEYXLATE`, `UIM_KEYDOWN`) | The panel key bindings — attack menus, attack options, inventories, runes, cast, caster. CSBWin has no keys of its own: `config.txt` binds a scancode to a screen point and a mouse button, and `UIM_KEYDOWN` clicks there. This binds the handlers those clicks reach |
| `ui/HitTest.ts` | `Mouse.cpp` | `searchButtonList`, `pointInRect` — the leaf both Mouse and the panels depend on |
| `ui/ReIncarnate.ts` | `Code13ea4.cpp` | The name-entry screen a reincarnated champion gets: the two fields, the letter grid, and the duplicate-name rule. The one **modal** screen in the UI — while `ui.reincarnate` is set, `Mouse.ts` and the host's key handler hand it every click and every key |
| `ui/Menu.ts` | `Menu.cpp` | `_DoMenu` and `_WaitForMenuSelect`: graphic 0, the four option layouts and their self-blits, `CenteredText`/`SplitLongLine`, the 210-213 button sets and the two-pass press animation. See `doc/CSBWIN_MENU_REFERENCE.md` |
| `ui/SaveMenu.ts` | `SaveGame.cpp` (`_DisplayDiskMenu`), extended | The save/load screen behind the disk icon. Keeps `_DoMenu`'s art and animation and replaces the four-slot chooser with a scrolling list over `src/data/saves/`. **Modal** like `ReIncarnate.ts`, and clicks reach it straight from the DOM event so the folder picker keeps its user activation |
| `ui/Inventory.ts` | `CSBUI.cpp` | Inventory screen, slot rectangles, the open chest, the eye's object-info panel, scroll reading, the Hall of Champions menu (`TAG0189a8`) |
| `ui/Character.ts` | `Character.cpp` | Portraits, hand icons, shield dots, the damage figure over a hurt champion's name (`DisplayCharacterDamage`'s blit), life/stamina/mana bars, attributes, food/water, carried load, possession slots |
| `ui/Feeding.ts` | `Character.cpp` | The mouth button and the chew animation. Derives a `FEEDPARAMETERS` block (`_FeedCharacter`'s first half); `src/engine/Feeding.ts` applies it (`applyFeedParameters`) |
| `ui/MagicPanel.ts` | `Magic.cpp` (UI half) | Rune keypad, the incantation being assembled, its mana cost |
| `ui/Attack.ts` | `Character.cpp` (attack half), `CSBCode.cpp:8718-8862` | The attack buttons and the attack menu: legal options, the per-tick panel state, the damage flash |
| `ui/Objects.ts` | `Objects.cpp`, `Code17818.cpp` | Name-index resolution, description phrases, weight, `DetermineMastery` |
| `ui/Light.ts` | `Viewport.cpp`, `Code17818.cpp` | Torch and magic-light totals → which `palette552` set to draw with |
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
| `intro/TitleSequence.ts` | `CSBCode.cpp:9203` (`_DisplayChaosStrikesBack`) | The title animation and `ShrinkBLT`'s 16.16 fixed point |
| `intro/PrisonDoor.ts` | `CSBCode.cpp:9459` / `:9545` / `:9379` / `:9629` | The dungeon entrance, its three buttons, the 31-frame door animation and the credits scroll |
| `intro/PrisonLevel.ts` | `CSBCode.cpp:9556-9576` | The synthetic 5×5 level behind the doors, as a `DungeonState` the real viewport renderer can read |
| `intro/BootSequence.ts` | `CSBCode.cpp:11338` (`_AskWhatToDo`) | The input queue, the VBL clock and the order the screens run in |

## `GameScreen` and `ViewportRenderer`

`src/renderer/GameScreen.ts` is the screen. It owns the canvas and the `UIState`, and takes
the interface's hooks out as one object at construction (`GameScreenHooks`, as `GameHost` is
the engine's). `presentViewport()` composites every panel over the viewport and converts the
palette indices to RGBA through the UI palette and the light level's viewport palette. It
also hosts the save menu and the Reincarnate screen. Its public methods —
`searchMouseButtons`, `handleMouseButton`, `tryPickViewportObject`,
`resolveViewportCursorAction`, … — are thin wrappers, because `src/ui/events.ts` and
`main.ts` call the screen, not the UI modules. They delegate and do nothing else.

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
