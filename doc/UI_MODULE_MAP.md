# UI module map

Where the DM user interface lives after the Phase 14 split, and which CSBWin file each
module is a translation of. `ViewportRenderer` used to hold all of this in one 3809-line
class; keeping the names aligned with the C++ is what makes the two codebases greppable
against each other.

## The shared state

`src/renderer/ui/UIState.ts` — CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`,
`Character.cpp` and `Magic.cpp` all reach into. Here it is one object that
`ViewportRenderer` owns and every UI function takes as its first argument:

- **data sources**: `graphicsLoader`, `dungeonState`, `context` (the bytecode interpreter
  context), `screenIndexBuffer`, `uiTables`, `objectTables`, `fontData`, `partyState`,
  `uiMode`
- **interaction state**: `pressingEye`, `hoverPoint`, `showAttackPanel`, the open chest,
  the chew-animation clock, the two button lists, `reincarnate` (non-null while the
  name-entry screen is modal)
- **CSBWin's mouse ring buffer**: `mouseQueue`, `mouseQStart`, `mouseQEnd`
- **bitmap caches**: `graphicCache`, cursor bitmaps, the portrait sheet
- **hooks out**: `playSound`, `onObjectMove`, `onSpellCast`, `viewingFilter`,
  `onResurrectReincarnateCancel`, `onReincarnateNamed`
- **hooks back into the renderer**: `getGraphicBitmap`, `renderLastFrame`

A function that turns out not to need the state does not take it — the pure helpers
(`formatLoad`, `testThrow`, `searchButtonList`, …) have plain signatures.

## The modules

| Module | CSBWin counterpart | Holds |
| --- | --- | --- |
| `ui/Mouse.ts` | `Mouse.cpp` | Click ring buffer, the `word0` button dispatcher (including its `PotentialCharacterOrdinal` gates), clothing/party/inventory click handlers, `tag01a6ea` for the eye panel, the cursor and hover highlights |
| `ui/HitTest.ts` | `Mouse.cpp` | `searchButtonList`, `pointInRect` — the leaf both Mouse and the panels depend on |
| `ui/ReIncarnate.ts` | `Code13ea4.cpp` | The name-entry screen a reincarnated champion gets: the two fields, the letter grid, and the duplicate-name rule. The one **modal** screen in the UI — while `ui.reincarnate` is set, `Mouse.ts` and the host's key handler hand it every click and every key |
| `ui/Inventory.ts` | `CSBUI.cpp` | Inventory screen, slot rectangles, the open chest, the eye's object-info panel, scroll reading, the Hall of Champions menu (`TAG0189a8`) |
| `ui/Character.ts` | `Character.cpp` | Portraits, hand icons, shield dots, life/stamina/mana bars, attributes, food/water, carried load, possession slots |
| `ui/Feeding.ts` | `Character.cpp` | The mouth button and the chew animation. Derives a `FEEDPARAMETERS` block (`_FeedCharacter`'s first half); `src/engine/Feeding.ts` applies it, through the `applyFeeding` hook |
| `ui/MagicPanel.ts` | `Magic.cpp` (UI half) | Rune keypad, the incantation being assembled, its mana cost |
| `ui/Attack.ts` | `Character.cpp` (attack half), `CSBCode.cpp:8718-8862` | The attack buttons and the attack menu: legal options, the per-tick panel state, the damage flash |
| `ui/Objects.ts` | `Objects.cpp`, `Code17818.cpp` | Name-index resolution, description phrases, weight, `DetermineMastery` |
| `ui/Light.ts` | `Viewport.cpp`, `Code17818.cpp` | Torch and magic-light totals → which `palette552` set to draw with |
| `ui/Draw.ts` | `CSBUI.cpp` | Screen-buffer primitives (`fillRect`, shading, object icons, bars) and the static chrome |
| `ui/ViewportPicking.ts` | `Mouse.cpp`, `Viewport.cpp` | What the point under the cursor refers to |

## What `ViewportRenderer` still owns

Viewport composition, and only that: initialisation and table extraction, the palette sets
and per-level monster colour overrides, the wall / floor-ceiling / mirrored-bitmap caches,
`render()`, `presentViewport()`, `blitViewportToScreen()`, and monster attack-sound state.

It also keeps thin public wrappers — `enqueueMouseClick`, `processMouseQueue`,
`tryPickViewportObject`, `resolveViewportCursorAction`, … — because `src/ui/events.ts` and
`main.ts` call the renderer, not the UI modules. Those wrappers delegate and do nothing
else.

## Picking is a reverse lookup, not a projection

Worth knowing before touching `ViewportPicking.ts`: the bytecode renderer records, for every
object and wall feature it blits, the screen rectangle it occupied plus the object's RN
(`context.viewportObjectButtons` / `viewportObjectRNs`). A click is resolved by scanning
that frame's records — CSBWin does the same rather than projecting the click back into the
dungeon.

## Verifying a change here

`tools/check-frames.sh` byte-compares five live screen states against `tools/frames/`.
See the header of `tools/probe-frames.mjs` for how to start the dev server and headless
Chrome it needs. It covers rendering plus the inventory open/select click path; throwing,
dropping, chests, feeding and casting are **not** exercised.
