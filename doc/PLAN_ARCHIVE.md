# dmweb – Completed Phase Archive

Full working notes for the phases that are **done**. Split out of `PLAN.md` so that the
live plan stays small — this file is reference material, read it only when you need the
detail of how a finished phase was actually carried out.

**`PLAN.md` remains the authority on status, and `DEBT.md` on debt.** Every item in these
archived phases that is still open is listed in `DEBT.md`; this file holds the surrounding
context for those items, not their status. If the two ever disagree, `DEBT.md` wins and
this file is stale.

Marker meanings are the same as in `PLAN.md`: ✅ done · ⚠️ diverges/incomplete ·
⏳ not started · 🚫 deliberately skipped.

---

### Phase 0 — Consolidate rendering entrypoint
Goal: ensure there is exactly one authoritative renderer path.

1. Keep the bytecode-based `ViewportRenderer` as the only runtime renderer.
2. Remove older/manual renderers and guessed coordinate sources from the repo.

Status: ✅ completed.

### Phase 1 — Load CSBWin viewport tables from `graphics.dat` (critical)
Goal: eliminate guessed rectangles/offsets by reading the same data CSBWin reads.

1. Implement a small loader for `graphics.dat` “graphic `0x22e`” and parse the `DATA` subregion that starts at `d.Byte7248+2` (see `doc/CSBwin-src/CSBCode.cpp:10125` and `doc/CSBwin-src/Data.h:1109+`).
2. From that decompressed blob, extract at least:
   - `wallRectangles[14]` (`Data.h:1238`) including byte fields (`uByte4..uByte7`) used by `BltShapeToViewport()`.
   - Related rectangle tables that opcodes reference (floor pits, teleporters, stairs, doors) as needed by the implemented opcode set.
3. Add a dev-only “dump tables” helper (e.g. `tools/dump-viewport-tables.ts`) to output JSON for inspection and regression checks.

Validation
- Cross-check extracted indices against CSBWin’s pointer functions:
  - `Viewport.cpp:2298` `StdRectanglePointers()`
  - `Viewport.cpp:2261` `StdBitmapPointers()`

Status:
- ✅ `wallRectangles[14]` + adjacent viewport rectangle tables extracted at runtime from `graphics.dat` item `0x22e` and wired into the interpreter (`src/renderer/csbwin/ViewportTables.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Extraction uses the packed tail layout declared in CSBWin `doc/CSBwin-src/Data.h:1184-1316` (graphic `0x22e`) and matches how CSBWin reads it (`doc/CSBwin-src/CSBCode.cpp:10125`).
- ✅ `StdRectanglePointers()` semantics are now represented directly in the interpreter (CSBWin `doc/CSBwin-src/Viewport.cpp:2298+`) so future opcodes can consume a single “rectangle pointer” value instead of guessed array indices.
- ✅ Dev tooling:
  - `tools/check-graphic-22e.mjs`
  - `tools/dump-viewport-tables.mjs`
- ✅ Extracted/wired `0x22e` tables (all `RectPos` byte-rects):
  - `teleporterRectangles[12]`, `DoorRectsF*[*]`, `DoorTrackTopRect[7]`, `DoorFrameRect[8]`, `CeilingPit[9]`, `FloorPitRect[12]`, `StairEdgeRect[8]`, `StairFacingDownRect[11]`, `StairFacingUpRect[11]`, plus CSBWin’s “see-thru” helpers (`Viewport.cpp:2405-2406`, `Viewport.cpp:2576-2587`).

### Phase 2 — Make the low-level blitter faithful (pixel-index buffer first)
Goal: make “draw primitives” match CSBWin semantics before completing high-level logic.

1. Replace RGBA-only drawing with a **palette-index viewport buffer** (size `224*136`, values 0–15):
   - This matches CSBWin’s “color index 10 = transparent” behavior directly.
   - Convert to RGBA only at final present (`putImageData`).
2. Port the behavior of CSBWin’s `TAG0088b2()` at the semantic level:
   - Respect `RectPos` byte fields for `srcX/srcY/srcWidth` and destination rectangle.
   - Implement color-key transparency (`transparentColor=10`).
   - Ensure inclusive coordinate behavior is consistent with CSBWin usage.
3. Implement `BltShapeToViewport()` and `BltRectangleToViewport()` in terms of the palette-index buffer.
4. Implement viewport presentation equivalent of `BLT2Screen()` (copy viewport to screen canvas at `x=47,y=33`).

Validation
- 🚫 Never carried out (no test framework exists). Tracked in Phase 15.

Status:
- ✅ Palette-index viewport buffer + present-to-RGBA staging (`src/renderer/csbwin/CanvasBlitter.ts`).
- ✅ `TAG0088b2` semantic port for decoded pixels (`tag0088b2Index`) + wrappers (`bltShapeToViewportIndex`/`bltRectangleToViewportIndex`).
- ✅ Runtime renderer now draws into the index buffer and presents to screen at `(47,33)` (`src/renderer/ViewportRenderer.ts`).

### Phase 3 — Port CSBWin’s floor/ceiling pipeline
Goal: match the frame composition order and caching.

1. Implement `FloorAndCeilingOnly()` semantics (CSBWin `Viewport.cpp:~3322`):
   - Copy cached floor/ceiling templates into the viewport buffer sections.
   - Respect the “redraw only when dirty” flag behavior.
2. Implement per-frame `Mirror()` behavior controlled by `(x + y + facing) & 1` (see `Viewport.cpp:6740+`):
   - Mirror floor OR ceiling buffers as CSBWin does.
3. Ensure the bytecode renderer assumes the same state (walls/objects blit “on top” of floor/ceiling).

Status:
- ✅ Floor/ceiling background composed into the palette-index viewport buffer using CSBWin’s section sizes (ceiling 29, black 37, floor 70) (`doc/CSBwin-src/Viewport.cpp:3327-3329`, `doc/CSBwin-src/CSBCode.cpp:10122-10123`).
- ✅ Per-frame parity logic implemented: `(x + y + facing) & 1` selects whether floor or ceiling is mirrored (`doc/CSBwin-src/Viewport.cpp:6740-6754`) and uses mirror-mode wall bitmaps for that frame.
- ✅ Style selection wired from dungeon map descriptor: `MapDescriptor.floorCeilingStyle` ↔ CSBWin `backgroundGraphicSet()` and `MapDescriptor.mapGraphicsStyle` ↔ CSBWin `wallGraphicSet()` (`src/data/DungeonLoader.ts:162`).

### Phase 4 — Make `SummarizeRoomInfo()` authoritative
Goal: drive program selection and opcode behavior from real dungeon state.

1. Implement a CSBWin-like `SummarizeRoomInfo()` in TS:
   - Determine `roomType` and `graphicRoomType` for each of 21 cells.
   - Correctly classify door edge vs door facing, stair edge vs stair facing, pits, teleporters, false walls.
2. Implement the minimal data queries needed by opcodes:
   - Door state (open/closed/anim position) from DB records + cell flags.
   - Decorations/text references per wall face.
   - Object list / contents for a cell (even if object drawing is deferred).

Validation
- ⚠️ Done informally by playing, never scripted. Tracked in Phase 15.

Status:
- ✅ CSBWin `SummarizeRoomInfo` logic ported from `doc/CSBwin-src/Codea59a.cpp:225` (`src/renderer/csbwin/SummarizeRoomInfo.ts`), including door/stair edge-vs-facing classification and out-of-bounds `GetCellFlags` behavior (`doc/CSBwin-src/CSBCode.cpp:4609`).
- ✅ Added object-list queries and RN link traversal (`GetObjectListIndex`, `FindFirstObject`, `GetDBRecordLink`, `FindFirstDoor`) in `src/engine/DungeonState.ts`.
- ✅ Interpreter now consumes real `roomData` values for door state/index, cell contents, cell XY, and `HasDecoration`/wall-decoration position semantics (`doc/CSBwin-src/Viewport.cpp:2633-2643`) in `src/renderer/bytecode/BytecodeInterpreter.ts`.
- ⚠️ Not yet ported: DSA-based decoration gating, footprints/extended cell flags; wall and floor decoration selection now follow `TAG00a4a2` + actuator wallGraphicOrdinal for stone/open rooms.

### Phase 5 — Complete opcode surface area (incremental)
Goal: make the bytecode interpreter render full scenes.

Implement in small, testable batches:
1. Core draw ops: `StdBltShape`, `StdGraphicToViewport`, `StdMirrorGraphicToViewport`, `StdBltShapeToViewport`, `StdMirrorShapeToViewport`.
2. Rect/bitmap selectors: all `Std*Rectangle*` and `Std*Bitmap*` pointer resolution backed by extracted tables.
3. Doors: `DoorSwitch`, `StdDrawDoor`, `StdDrawDoorSwitch`, door frame/track drawing.
4. Pits/teleporters/stairs: rectangle + graphic selection and drawing ops.
5. Decorations/text: wall decoration placement and text overlay.
6. Objects: draw order, occlusion, per-distance sprite selection.

Validation
- 🚫 Never built. `tools/` contains data-dump scripts only, no render probe. Tracked in Phase 15.

Status:
- ✅ CSBWin-style `StdBitmapPointers()` and `StdRectanglePointers()` plumbing for `StdBltShape`/`StdBltShapeToViewport`/`StdMirrorShapeToViewport` (`src/renderer/bytecode/BytecodeInterpreter.ts`).
- ✅ `StdGraphicToViewport` + `StdMirrorGraphicToViewport` implemented via basic-graphic resolver (`src/renderer/bytecode/BytecodeInterpreter.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Door “frame/track” bitmaps loaded per wall set (`graphics.dat` indices `77..83` for wall set 0, per CSBWin `ReadWallBitmaps()` in `doc/CSBwin-src/CSBCode.cpp:2870`) and used by bytecode programs (`src/renderer/ViewportGraphics.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Stair graphic opcodes now compute CSBWin per-wallset indices (base `90 + wallSet*18`, per `doc/CSBwin-src/Code390e.cpp:117-127`) so stairs/pits can render using `StdGraphicToViewport`.
- ✅ `StdDrawRoomObjects` now draws non-monster room items (weapons/clothing/scrolls/potions/chests/misc) using CSBWin tables from `graphics.dat` (`0x22e`: `s5604`, `viewportPosition`, `smallOffsets`; `0x22f`: `ObjDesc.graphicClass`) and correct hex draw-order constants (`doc/CSBwin-src/Viewport.cpp:2611-2630`).
- ✅ `StdDrawDoor` now draws door panels using extracted door rect tables (`graphics.dat` `0x22e`) and CSBWin door-graphic selection derived from `Door1Type/Door2Type` (`doc/CSBwin-src/Code390e.cpp:180-199`, `doc/CSBwin-src/CSBCode.cpp:4134-4194`) (`src/renderer/bytecode/BytecodeInterpreter.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Wall decorations + wall text are now rendered by the interpreter: decoration placement uses `wallDecorationPosition[8][13]` + `Byte4100[60]` from `graphics.dat` `0x22e` and per-level `WallDecorationTOC` bytes parsed after CELLFLAGs (`doc/CSBwin-src/CSBCode.cpp:5791-5808`, `doc/CSBwin-src/CSBCode.cpp:3133+`) (`src/renderer/csbwin/ObjectTables.ts`, `src/data/DungeonLoader.ts`, `src/renderer/bytecode/BytecodeInterpreter.ts`).
- ✅ Random floor decoration selection + actuator-driven floor decoration ordinals now populate `roomData.decorations[2]` for open-like rooms (`doc/CSBwin-src/Codea59a.cpp:299-351`, `doc/CSBwin-src/CSBCode.cpp:5696-5739`) (`src/renderer/csbwin/SummarizeRoomInfo.ts`).
- ✅ `StdDrawFloorDecoration` now renders floor decorations using `floorDecorDesc`, `RelativeCellGraphicIncrement`, and per-level `FloorDecorationTOC` (`doc/CSBwin-src/CSBCode.cpp:3780-3955`, `doc/CSBwin-src/Code390e.cpp:263-272`) (`src/renderer/bytecode/BytecodeInterpreter.ts`, `src/renderer/csbwin/ObjectTables.ts`).
- ✅ `StdDrawCeilingPit` now mirrors CSBWin `CheckCeilingPit`, drawing ceiling pit bottoms from the level above using `CeilingPit[9]` + hardcoded graphic indices (`doc/CSBwin-src/CSBCode.cpp:4209-4258`) (`src/renderer/bytecode/BytecodeInterpreter.ts`).
- ✅ Extended wall/floor decorations now load from `CSBgraphics.dat` and render via ReadWallDecoration/ReadFloorDecoration semantics (`doc/CSBwin-src/Graphics.cpp:3201+`, `doc/CSBwin-src/CSBCode.cpp:3073-3807`) (`src/data/CSBGraphicsLoader.ts`, `src/renderer/bytecode/BytecodeInterpreter.ts`, `src/main.ts`).
- ✅ Teleporter draw opcode now renders using `graphics.dat` `0x22e` teleporter descriptors (`DrawTeleporter`, `doc/CSBwin-src/CSBCode.cpp:4266`), with a CSBWin-style `TAG008c98` chunky port for mask/overlay blits.
- ✅ `DrawRoomObjects` now handles monsters/missiles/clouds in addition to items, using CSBWin tables from `graphics.dat` `0x22e/0x22f` (`Word7042/7162/7222/7246`, `Byte5752/5758/5696`, `struct5688`, `Item6414`, `MonsterDescriptor`) and object list traversal (`doc/CSBwin-src/Code51a4.cpp:2618+`).
- ✅ Monster palette special-colors now applied per level: `specialColors[13][7]` + `ITEM12.uByte11` drive `ModifyPalettes` for colors 9/10, updating `Palette552` and `Byte6628/Byte6612` (`doc/CSBwin-src/Code390e.cpp:323-343`, `doc/CSBwin-src/CSBCode.cpp:2839-2854`).
- ✅ Timer-driven missile orientation and Item16/SINGLE_MONSTER_STATUS plumbing added (falls back safely when save-game state is absent).
- ✅ Minimal save-game loader added for Item16/timer tables (non-extended saves) (`src/data/SaveGameLoader.ts`).
- ✅ Deterministic `GraphicRandom()` implemented for teleporter/cloud randomness (`doc/CSBwin-src/CSBCode.cpp:564`).
- ⚠️ Remaining fidelity gaps: extended-feature save games (sequenced/extended timers + DSA blocks), full monster attack/alternate-graphics state, and exact missile mirror/flip edge cases.

Next steps (Phase 5 follow-up):
1. ✅ Integrated `loadSaveGameState`/`applySaveGameState` into runtime load flow so Item16/timers drive rendering (`src/main.ts`, `src/engine/Game.ts`).
   Description: load/save runtime Item16/timers and apply them before rendering so missile/monster states reflect saved timer data.
2. ✅ Extended save-game loader handles extended-feature saves (sequenced/extended timers + DSA blocks + DSA level index) (`src/data/SaveGameLoader.ts`).
3. ✅ Tightened missile mirror/flip edge cases to use CSBWin parity test (`src/renderer/bytecode/BytecodeInterpreter.ts`).
4. ✅ Ported `TAG00a4a2` + `RandomWallDecoration` (CSBCode.cpp:5714+ / 5696+) and `SummarizeStoneRoom` actuator wallGraphicOrdinal handling (Codea59a.cpp:44-176).
5. ✅ DSA gating for wall/floor decorations (`actuatorType==47` with `DSALevelIndex` / `ParameterA/B`) implemented in summarize step (`src/renderer/csbwin/SummarizeRoomInfo.ts`).

### Phase 6 — Custom skins / BACKGROUND_LIB
Goal: support CSBWin’s per-cell “skin” overrides even when the base DM dungeon does not use them.

1. Identify whether the shipped DM dungeon uses custom backgrounds.
2. Port the minimal `BACKGROUND_LIB`/`skinCache` behaviors needed to select and execute custom code per cell.

Status: 🚫 skipped — the shipped DM dungeon does not use custom backgrounds, so this is
only needed to support third-party CSBWin dungeons. Revisit if we ever load one.

### Phase 7 — UI Rendering (faithful DM layout)
Goal: render the original Dungeon Master UI (portraits, status bars, hands, controls, and message area) with CSBWin-accurate layout and graphics.

1. ✅ **Inventory CSBWin UI entrypoints and tables**. Use `doc/CSBWIN_UI_REFERENCE.md` as the authoritative UI layout record and extract UI tables from `graphics.dat` (graphic `0x232`: `wRectPos1780/1788/1796`, `wRectPos1454`, `Word12/20/28`, `IconDisplay[46]`, `Word612[7]`; graphic `0x230`: `Word20242`, `wRectPos20202/20210/20218`; graphic `0x231`: `Buttons*` and `MoveButn*` hit-test rectangles).
2. ✅ **Introduce a screen-level draw pipeline**. Add a 320x200 screen buffer and copy the 224x136 viewport into it at `(0,33)` using the CSBWin stride (112 bytes per row into a 160-byte screen stride); reuse `TAG0088b2`-style blits with palette-index transparency for UI elements.
3. ✅ **Draw static UI frame**. Fill the top bar, right panel, and scroll area using `wRectPos1780/1788/1796`, and draw movement buttons by blitting basic graphic 13 into `Word28`.
4. ✅ **Draw dynamic party state (top bar + right panel)**. Implement portrait slots, name strip, inventory portrait, position/dir indicator, attack buttons, and hands/backpack icons using the CSBWin geometry and `IconDisplay[46]`/`Word612[7]` mapping.
5. ✅ **Attack/spell control UI**. Attack options clear `Word20`, blit basic graphic 10 into `wRectPos20202/20210/20218`, and draw text at `(235,83)` and `(241,93+12*row)`; spell controls now clear `Word20242`, apply `vblFlashButn` rectangles, and draw the caster name at CSBWin coordinates.
6. ✅ **Message area + text**. Use the font graphic `0x822d` (loaded into `Pointer12926`) with `TextOut_OneLine`; render message rows at 6-pixel char width and 7-pixel line height, base Y = 177.
7. ✅ **Input hit-tests (visual only at first)**. Map mouse/keyboard regions to UI elements using `Buttons*` and `MoveButn*`, and draw hover/selection highlights (no interaction logic yet).
8. ✅ **Portraits**. Wire `portraitGraphic` to champion data, load internal/external portrait graphics, render real portraits in the top bar and inventory, and add shield dots with the correct per-champion offsets and colors.
   - Note: shield dot rendering is wired but shield values are not yet populated by gameplay state (`partyShield`, `fireShield`, `spellShield`, `champion.shieldStrength`).
9. ✅ **Status bars**. Implement health/stamina/mana bars in the top bar using CSBWin masks and height rounding with per‑champion colors.
10. ✅ **Inventory screen**. Paper-doll slots, backpack grid, eye/mouth overlays (inspect
   arrow, feeding via mouth, chew animation), wound outlines, and object-in-hand/selection
   interactions are implemented (`src/renderer/ViewportRenderer.ts`).
11. ✅ **Character stats**. Render stat panels (attributes and skill titles/levels) using CSBWin text layout, including base values, modifiers, and any highlight states.
12. ✅ **Chests + scrolls**. Chest grid view (open/repack/sync) and scroll view
   (`drawScrollPanel`, max 9 lines) are implemented and connected to container/scroll data.
13. ⏳ **Magic panel**. Render the spell panel contents (rune slots, selected runes, and labels), implement highlight/flash rectangles, and gate visibility by caster state (remaining: rune click flash effect).
14. ⏳ **Attack panel**. Still a placeholder: `drawAttackPanel()` picks the first alive
   champion rather than the acting one, `PossibleAttackTypes` is not ported at all, and
   visibility is driven by a debug toggle (F7) instead of real attack state. Depends on
   Phase 12 for meaningful attack actions.
15. ⏳ **Interaction highlights**. Add button press/selection effects (flash, shading, or invert) across UI regions, and ensure highlight behavior is consistent with hit-test rectangles and current UI mode.

Status:
- ✅ UI tables extracted from `graphics.dat` (0x230/0x231/0x232) and wired into the renderer (`src/renderer/csbwin/UITables.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Screen-level palette-index buffer added; viewport now blits into the screen buffer before present at (0,33) (`src/renderer/ViewportRenderer.ts`, `src/renderer/ViewportGraphics.ts`).
- ✅ Static UI frame clearing + movement buttons drawn using CSBWin tables and basic graphic 13 (`src/renderer/ViewportRenderer.ts`).
- ✅ Message line rendering uses CSBWin font graphic 0x22d with 6x6 glyphs and 7-pixel line height (`src/renderer/csbwin/TextRenderer.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Top-bar dynamic rendering wired to party state (name strip, portrait slot clear, position/dir indicator) with CSBWin geometry (`src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Debug hotkey injects a randomized party and quick-saves for rapid UI testing (F8) (`src/main.ts`, `src/engine/Game.ts`).
- ✅ Attack buttons + weapon-ready panel UI drawn with CSBWin geometry and placeholder text (`src/renderer/ViewportRenderer.ts`).
- ✅ Attack button icons now draw from object icon sheets using CSBWin `Word612` grouping (debug uses randomized `weaponHand` indices) (`src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Top-bar hand slots draw object icons using `IconDisplay[0..7]` with CSBWin object sheets (`src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Hover highlights for movement and attack buttons using `MoveButn*` + UI geometry (`src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Hover highlights now include all `Buttons*` rectangles from UI tables for broad hit-test visualization (`src/renderer/ViewportRenderer.ts`).
- ✅ Item icon blits now use correct sheet stride (256px) to avoid sliced/interlaced artifacts (`src/renderer/ViewportRenderer.ts`).
- ✅ Attack panel visibility gated by a debug toggle (F7) instead of always rendering (`src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Combat panel icons now render using the ShrinkBLT color map logic (Byte20194), producing black mask over cyan (`src/renderer/ViewportRenderer.ts`).
- ✅ Status bars now render with CSBWin masks and empty‑bar color 15, filling per‑champion colors at the correct height (`src/renderer/ViewportRenderer.ts`).
- ✅ Inventory view now toggles via party block buttons and cursor-owner hot area (button 83), hides the dungeon view, draws the inventory background, and renders item icons for slots 0‑29 with CSBWin placeholder/wound icons (`src/renderer/ViewportRenderer.ts`).
- ✅ Inventory view draws the selected champion name at `(3,7)` in viewport space and renders the food/water panel (graphics 20/30/31/32 with CSBWin bar math/colors) (`src/renderer/ViewportRenderer.ts`).
- ✅ Character stats panel (skills + attributes) and load readout are now rendered in the inventory view (`src/renderer/ViewportRenderer.ts`).
- ✅ Champion state extended for inventory and condition flags: `possessions[30]`, `wounds`, `food`, `water`, `poisonCount` (`src/engine/gameTypes.ts`, `src/main.ts`).
- ✅ Magic panel runes/incantation rendering wired; ⏳ rune click flash effect still missing (`src/renderer/ViewportRenderer.ts`).
- ✅ Inventory view completed since: eye/mouth overlays, chest and scroll subviews, and
  object-in-hand/selection interactions are all implemented.
- ⏳ Remaining Phase 7 gaps: rune click flash effect, real attack panel (item 14),
  and interaction press/flash highlights (item 15).

Validation
- 🚫 Never carried out. No comparison against CSBWin screenshots was made, and no
  pixel-alignment verification exists. Tracked in Phase 15.

### Phase 7.5 — Light level / palette switching (viewport)
Goal: match CSBWin global light level logic and palette selection.

1. Load `Palette552[6]`, `PaletteBrightness[6]`, and `Word1074[16]` into runtime state (from graphics block `0x232`).
2. Port `SelectPaletteForLightLevel` to compute `totalLight` from torches-in-hand and `d.Brightness` with the CSBWin weighting.
3. Port `SetBrightnessTimer` + `ProcessLightLevelTimer` and wire `TT_LIGHT` handling into the timer system.
4. Apply `CurrentPalette` to viewport rendering only (mirror CSBWin `Palette11946` semantics) without dimming portraits/text.
5. Hook equip/unequip (Illumulet), spell effects, torch charge decay, and attack light effects to call `SelectPaletteForLightLevel`.
6. Add logging/trace tooling to compare palette index changes against CSBWin for known light events.

Status:
- ✅ Light tables (`PaletteBrightness`, `Word1074`, `Palette552`) parsed from graphic `0x232` and wired into runtime (`src/renderer/csbwin/UITables.ts`, `src/main.ts`).
- ✅ `SelectPaletteForLightLevel` logic ported in renderer (torch weighting + `d.Brightness` + `experienceMultiplier` gate).
- ✅ `TT_LIGHT` handling + `ProcessLightLevelTimer` ported with `timerWord6` support; `Game.setBrightnessTimer` added for scheduling.
- ✅ Viewport-only palette applied during present; UI uses palette 0 (`src/renderer/csbwin/CanvasBlitter.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Illumulet equip/unequip adjusts `d.Brightness` for inventory UI + DSA moves; torch-in-hand sets `litTorch` bit for visuals.
- ✅ 90-second torch charge decay tick added (hands only), mirroring `NinetySecondUpdate` behavior.
- ✅ Spell light effects implemented as part of Phase 9.75 class-3 spells (light/darkness
  adjust `d.Brightness` via `applyBrightnessSteps` + `setBrightnessTimer`).
- ⏳ Pending: attack-driven light effects (depends on Phase 12); light-level trace hook.

### Phase 8 — CSBWin-Compatible actuators
Goal: match CSBWin’s actuator pipeline (trigger evaluation -> queued timers -> room-type effects -> DSA/monster/missile behavior).

1. **Actuator data parity**. Mirror DB3 bitfields and helpers (actuatorType, action, onceOnly, normallyClosed, localActionOnly, targetX/Y/pos, delay, value, DSA selector/state/parameters) per `doc/CSBwin-src/CSB.h:927-1075`.
2. **Timer core**. Implement a CSBWin-style timer queue with `TIMER` layout (time, level, function, uByte5-9) and ordering rules, including `CreateTimer()` semantics from `doc/CSBwin-src/Mouse.cpp:176-206`.
3. **Actuator trigger evaluation**. Port `PressurePadOrAlcove()` logic from `doc/CSBwin-src/Code11f52.cpp:3660-3890`:
   - Floor pads vs wall switches
   - Party/monster/object/direction checks
   - `CONSTPRESSURE` behavior and “normally closed” logic
4. **QueueSwitchAction semantics**. Implement `QueueSwitchAction()` (`doc/CSBwin-src/Code11f52.cpp:3566-3636`) including:
   - `localActionOnly` → `PerformLocalAction()` (`doc/CSBwin-src/Mouse.cpp:222-260`)
   - Room-type → timer function mapping via `Byte1596` (graphic `0x232`) and `WarnIllegalTimer()`.
5. **Timer function handlers**. Port core room-type handlers from `doc/CSBwin-src/Timer.cpp`:
   - `TT_OPENROOM`, `TT_STONEROOM`, `TT_FALSEWALL`, `TT_TELEPORTER`, `TT_PIT`, `TT_DOOR`
   - DB2 show/hide text logic, cell-flag bit changes, and DSA/portrait hooks where present.
6. **Special actuator types**. Implement DB3 actuatorType behavior from `doc/CSBwin-src/CSB.h:927-1045` and `doc/CSBwin-src/Timer.cpp`:
   - Counters (type 6/48), monster generators (type 6 in open rooms), locks (types 3/4/11)
   - Missile launchers (types 7-10, 14-15)
   - `onceOnly` disable semantics.
7. **DSA runtime**. Add DSA execution engine (stack, variables, operations, filters) and DSA timer/message handling (`doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/Timer.cpp:ProcessDSATimer*`).
8. **Integration points**. Wire actuator triggers into movement/object placement (`PlaceOrRemoveObjectInRoom` path in `doc/CSBwin-src/Code11f52.cpp`) and ensure timers tick via the game loop.
9. **Extended features**. Support extended timers and big actuators using `ExtendedFeaturesBlock` flags (`doc/CSBwin-src/Chaos.cpp:1747-1765`) and DSALevelIndex when present.
10. **Validation tooling**. Add a debug “actuator probe” that:
    - Lists actuators at a cell with decoded fields
    - Steps timers and logs resulting cell/object changes for compare with CSBWin.

Follow-ups from recent Phase 8 work (not done yet):
- Implement CSBWin `ProcessTT_OPENROOM` text printing when a hidden text becomes visible and the party is standing on the cell.
- Implement `WiggleEverything()` effects for pit/teleporter timers to force falls when a cell toggles.
- Implement missile encounter resolution parity: party/monster hit routing + damage logic, and correct projectile recovery/drop behavior.
- Implement missile decay rates (`deltaEnergy`) for non-launch sources (spell/throw) and store into `timerWord8` as CSBWin does.
- Implement door close crush behavior (party/monster damage) during `TT_DOOR_STEP`.

Status:
- ✅ Timer queue core implemented with CSBWin ordering rules and `CreateTimer()` semantics (`src/engine/TimerQueue.ts`).
- ✅ `PressurePadOrAlcove()` trigger evaluation ported for party stepping, using CSBWin actuator checks and action selection (`src/engine/ActuatorSystem.ts`, `src/engine/MovementSystem.ts`).
- ✅ Wall-switch click handling now follows CSBWin `TouchWall()` semantics for core switch/lock types (1/2/3/4/11/12/17) and queues timers via `QueueSwitchAction` (`src/engine/ActuatorSystem.ts`).
- ✅ Actuator lookup tables wired from graphics (`Byte1596`) + object name index resolution via ObjDesc (`src/renderer/csbwin/UITables.ts`, `src/main.ts`).
- ✅ `PerformLocalAction()` handles local action type 10 (skill increaser) and delayed actuator rotation markers (`src/engine/ActuatorSystem.ts`).
- ✅ Delayed actuator rotation now reorders actuator links in-place to mirror `RotateActuatorList()` semantics (`src/engine/ActuatorSystem.ts`, `src/engine/DungeonState.ts`).
- ⚠️ `PerformLocalAction()` does not yet map `HandChar` precisely; uses partyPosition matching when mapPos is specified.
- ✅ Timer processing now runs each tick and dispatches TT_OPENROOM/TT_STONEROOM/TT_FALSEWALL/TT_TELEPORTER/TT_PIT/TT_DOOR (`src/engine/TimerSystem.ts`, `src/engine/Game.ts`).
- ✅ Portrait timer responses are now applied for actuator type 127 using CSBWin response fields (`src/engine/TimerSystem.ts`, `src/data/actuatorHelpers.ts`).
- ✅ DSA/monster-generator/missile-launcher paths are now wired with hook callbacks + TT_ReactivateGenerator support (`src/engine/TimerSystem.ts`, `src/engine/TimerQueue.ts`).
- ✅ DSA runtime now loads save-game DSA blocks, resolves DSALevelIndex selectors, and executes DSA programs for timer5/6/7 (`src/data/SaveGameLoader.ts`, `src/engine/DsaSystem.ts`, `src/engine/Game.ts`).
- ✅ Added DSA ampersand ops for cell fetch/store, false pit toggles, generator delay, type/object-id, copy, and global fetch (`src/engine/DsaSystem.ts`).
- ✅ Implemented DSA `&ADD`/`&DEL`/`%MOVE` object manipulation with cursor/character/monster/chest locations and MoveObject-style source/destination validation (uses `CarryLocation` + `ObjDesc` carry masks), plus `objectInHand` state (`src/engine/DsaSystem.ts`, `src/engine/gameTypes.ts`, `src/engine/Party.ts`, `src/main.ts`).
- ⚠️ DSA interpreter still has many unimplemented ampersand subcodes (see TODOs in `src/engine/DsaSystem.ts`).
- ⚠️ Missile launch, monster creation, and WiggleEverything still require concrete engine hooks (see TODOs in `src/engine/TimerSystem.ts`).
- ⚠️ DSA object manipulation still skips cloud/missile timer updates and does not free DB records on delete (CSBWin uses deferred DeleteDBEntry).

Remaining implementation steps (detail):
1. **Big actuators + word8**. Add `word8` to `ActuatorRecord` and loader handling for `BigActuators` saves; mirror `MakeBigActuators()` + `DB3::MakeBig()` conversion and use `word8` for `ParameterA/B` high bits (`doc/CSBwin-src/SaveGame.cpp:2287-2315`, `doc/CSBwin-src/data.cpp:1327-1356`).
2. **TouchWall parity**. Expand wall actuator handling for types 13 (torch holder), 16 (swap), and 127 (add character) plus cursor filter hooks and DeleteDBEntry semantics for key removal (`doc/CSBwin-src/Mouse.cpp:290-605`).
3. **Object move triggers**. Implement `PlaceOrRemoveObjectInRoom`-style actuator checks for moved objects/monsters (not just party stepping), including DB2 text print on reveal and proper `movedObjectDBNum`/`movedObjectNameIndex` logic (`doc/CSBwin-src/Code11f52.cpp:3882-3950`).
4. **TT_OPENROOM gating**. Match `TT_DESSAGE`/`TT_ParameterMessage` behavior so DB2 show/hide only occurs for normal timers, and text prints when a hidden DB2 becomes visible with party on the tile (`doc/CSBwin-src/Timer.cpp:1688-1763`).
5. **TT_DOOR parity**. Mirror `ProcessTT_DOOR` requeue behavior (TT_1 transitions and door-state guards) instead of direct door-state writes (`doc/CSBwin-src/Timer.cpp:1556-1588`).
6. **Missile launcher logic**. Implement `TriggerMissileLauncher()` semantics for types 7–10/14/15, including object removal from room, spell construction, and missile launch positions/range (`doc/CSBwin-src/Timer.cpp:1883-2008`).
7. **Generator/teleporter side effects**. Add missing sound queues and `WiggleEverything()` fall forcing for pit/teleporter toggles (`doc/CSBwin-src/Timer.cpp:1772-1824`, `doc/CSBwin-src/Timer.cpp:2410+`, `doc/CSBwin-src/Timer.cpp:2548+`).
8. **DSA opcode coverage**. Audit `DSA.cpp` opcode tables vs `src/engine/DsaSystem.ts` and implement remaining `&` subcodes plus any missing stack ops; document coverage after each batch (`doc/CSBwin-src/DSA.cpp`).
9. **DSA filter wiring**. Add calls to `ProcessDSAFilter` for party move, missile encounters, action-name resolution, and character filters, with correct timer/location parameters (`doc/CSBwin-src/Code11f52.cpp:928-1040`, `doc/CSBwin-src/Character.cpp:4559-4573`, `doc/CSBwin-src/CSBCode.cpp:7792-7840`, `doc/CSBwin-src/CSBCode.cpp:8631-8705`).

### Phase 8.5 — Teleporter cell actions parity (Complete)
Goal: match CSBWin teleporter behavior for movement, visibility, sounds, and timer toggles.

1. **Teleporter record parity**. Honor DB1 bitfields exactly: destination X/Y/level, rotation, facingMode (absolute vs relative), scope (objects/monsters/party/anything), and audible buzz (`doc/CSBwin-src/CSB.h:855-879`).
2. **MoveObject teleporter loop**. Mirror CSBWin’s 1000-iteration teleporter chain with active-bit gating and scope checks, including the “pretend teleporter” one-shot path used by DSA TeleportParty (`doc/CSBwin-src/Code11f52.cpp:2899-3012`, `doc/CSBwin-src/DSA.cpp:4583-4609`).
3. **Party/monster/missile rotation parity**. Use `facingMode` to apply absolute or relative rotation for party, monsters, and missiles; apply the CSBWin `TeleportMonster` group-position logic and `TeleportMissile` direction/pos adjustment (`doc/CSBwin-src/Code11f52.cpp:2308-2410`).
4. **Sound + visibility gates**. Play `soundTELEPORT` only when `audible` is set (party channel 0, monster channel 1), and draw teleporters only when both visible and active bits are set in the cell flag (`doc/CSBwin-src/Code11f52.cpp:2962-2986`, `doc/CSBwin-src/Codea59a.cpp:354-357`, `doc/CSBwin-src/CSBTypes.h:203-205`).
5. **TT_TELEPORTER timers**. Toggle the cell active bit, run DSA activation, and call `WiggleEverything()` so occupants get reprocessed after activation (`doc/CSBwin-src/Timer.cpp:2390-2449`).
6. **Monster movement constraint**. Block monster movement onto an active teleporter when the destination level disallows the monster, matching CSBWin’s pre-move check (`doc/CSBwin-src/Monster.cpp:724-740`).

Status:
- ✅ Teleporter DB1 bitfields are parsed and consumed (destX/destY local coords, dest level, rotation/facingMode, scope, audible).
- ✅ MoveObject teleporter loop parity now applied in `TimerSystem.resolveCellEffects` (chain traversal + scope gating + per-type rotation).
- ✅ Party/Monster/Missile rotation parity implemented with Item16-aware facing/position updates.
- ✅ Party movement now routes through the teleporter loop and triggers actuators at the resolved destination.
- ✅ Pretend-teleporter one-shot path wired for DSA TeleportParty handling.
- ✅ Teleporter sounds now respect the DB1 audible flag; movement no longer plays unconditional teleporter sounds.
- ✅ TT_TELEPORTER timers toggle active bit, run DSA activation, and wiggle occupants on activation.
- ✅ Monster movement onto teleporters now blocks when the destination level disallows the monster (CSBWin pre-move constraint).

### Phase 9 — CSBWin-Compatible missiles behavior
Goal: match CSBwin’s missile lifecycle (launch → flight → encounter → resolution) as implemented in `doc/CSBwin-src/Timer.cpp` and `doc/CSBwin-src/Code11f52.cpp`.

1. ✅**Replace the missile data model**. Align DB14 records with CSBwin:
   - `flyingObject` (projectile RN), `rangeRemaining`, `damageRemaining`, `timerIndex`.
   - Store `timerWord8` directly on the missile timer entry (bits: x/y/dir/deltaEnergy); remove any parallel `eventIndex`/aux timer word table.
2. ✅**Rebuild missile launch paths**. Port:
   - `ThrowMissile()` (Timer.cpp) for hand throws.
   - `TriggerMissileLauncher()` (Timer.cpp) for actuator launchers.
   - Spell missile creation paths (Magic.cpp + Mouse.cpp `ConstructPredefinedMissile`).
   Remove the current simplified throw logic in `src/engine/Game.ts` and rewire throw input to the CSBwin path.
3. ✅**Port MissileTimer() exactly**. Implement CSBwin’s tick flow:
   - `TT_Missile0 → TT_Missile` on first tick.
   - Party/monster hit checks via `ProcessMissileEncounter(-2/-1, ...)`.
   - `deltaEnergy` decay for `rangeRemaining`/`damageRemaining`.
   - Leaving‑cell detection based on `(dir == pos) || ((dir+1)&3 == pos)`.
   - Wall/falsewall/stairs/exterior checks and door‑in‑cell collision via `ProcessMissileEncounter(roomType, ...)`.
   - Movement via `MoveObject()` so teleporter/stairs/pit/rotation logic is shared.
4. ✅**Port ProcessMissileEncounter()**. Bring over the collision pipeline from `Code11f52.cpp`:
   - Door interactions (Zo spell, pass‑through rules, door damage).
   - Potions → fireball/poison cloud conversion with strength.
   - Non‑material monster immunity, Black Flame fireball heal.
   - Monster absorption of thrown weapons into possession lists.
   - Cloud creation and sound effects.
5. ✅**Port ProcessObjectFromMissile()**. Match projectile recovery rules:
   - Link to monster possessions when requested (`pDest`).
   - Otherwise move to room with missile position preserved.
   - Always delete the missile record after processing.
6. ✅**Implement CheckMoveFromMissile() and MoveObject integration**.
   - When party/monster moves, scan missiles in the vacated cell and call `ProcessMissileEncounter()` using the leaving position.
   - Skip missiles still in `TT_Missile0`.
   - Ensure missile timers are deleted when a hit consumes the missile.
7. ✅**Missile encounter filters (DSA)**.
   - Port `MissileEncounterFilter()` and `missileFilterTimer`/`missileFilterObject` globals.
   - Wire `ProcessDSAFilter` for types 1–7 with correct `LOCATIONREL` + timer parameters.
8. ✅**Rendering correctness hooks**.
   - Use `timerWord8` direction for missile orientation/mirroring.
   - Ensure missiles whose timers are deleted do not render.
9. ✅**Save/load parity**.
   - Load `DB14.timerIndex` from saves, use the timer entry’s `timerWord8`.
   - Adjust runtime serialization to store updated DB14 fields and missile timers.
10. ✅**Validation tooling**.
    - Add a “missile trace” debug mode that logs each tick’s missile position, dir, range/damage, and encounter outcome.
    - Scripted scenario tests: throw into door, throw into wall, step‑away collision, potion splash, monster absorption.
11. ⏳ **ThrowByCharacter stats parity**.
    - Current placeholders: `Game.estimateThrowRange/estimateThrowDamage/estimateThrowDecay`.
    - Port CSBWin throw range/damage/decay calculations from skills, stamina, and item weight.
    - Replace the current estimate-based throw values with CSBWin logic.
    - Refs: `doc/CSBwin-src/Mouse.cpp:673+` (`ThrowByCharacter`), `doc/CSBwin-src/Attack.cpp:652+` (`DetermineThrowingDistance`), `doc/CSBwin-src/CSB.h:3729+`.
12. ⏳ **Door pass-through + magic damage parity**.
    - Implement DoorTOC pass-through rules and ObjDesc checks for missiles.
    - Port magic damage/poison formulas and Black Flame fireball healing.
    - Refs: `doc/CSBwin-src/Code11f52.cpp:1870+` (door pass-through in `ProcessMissileEncounter`), `doc/CSBwin-src/CSBCode.cpp:4156+` (`DoorTOC` lookup), `doc/CSBwin-src/Code11f52.cpp:1488+` (magic damage formulas), `doc/CSBwin-src/Code11f52.cpp:1976+` (Black Flame fireball heal).
13. ⏳ **Cloud timers/damage parity**.
    - Current state: `createCloud()`/`createCloudRecord()` create the DB13 record and add it
      to the cell, but **no timer is ever scheduled**. Clouds therefore render forever and
      deal no damage. This is a visible bug, not just a missing feature.
    - Implement cloud timers, per-tick damage, and size/decay rules from CSBWin.
    - Refs: `doc/CSBwin-src/Timer.cpp:479+` (cloud timer handling), `doc/CSBwin-src/Code11f52.cpp:1376+` (`CreateCloud` setup + timer linkage).
14. ⏳ **Remove dev debug and validation tooling** — see Phase 14, which covers this
    project-wide rather than only for missiles.

### Phase 9.5 — Skills & Experience parity
Goal: match CSBWin’s champion skill/experience pipeline (mastery, AdjustSkills, level-up, action hooks).

1. **Data model parity**. Ensure runtime champions store `skills92[20]` with `tempAdjust` + `experience`, and keep `LimitSkillExperience` identical to CSBWin (`doc/CSBwin-src/CSB.h`).
2. **Mastery calculation**. Implement engine-level `DetermineMastery` with `0x4000/0x8000` flags, base-skill inclusion for subskills, and possession bonuses (`doc/CSBwin-src/Code17818.cpp`).
3. **Skill adjustment pipeline**. Port `AdjustSkills` scaling (LastMonsterAttackTime gates + level experience multiplier), DSA AdjustSkills filter, tempAdjust increments, base-skill accumulation, and `LevelUp` (`doc/CSBwin-src/Magic.cpp`).
4. **Level-up effects**. Port `LevelUp` stat increments, caps, and UI messaging hooks (`doc/CSBwin-src/Magic.cpp`).
5. **Action hooks**. Wire skill gains and mastery effects for attacks, throws, monster hits, and spellcasting (`doc/CSBwin-src/Attack.cpp`, `doc/CSBwin-src/Mouse.cpp`, `doc/CSBwin-src/Monster.cpp`, `doc/CSBwin-src/Magic.cpp`).
6. **Timed updates**. Add `TenSecondUpdate` logic to drive mana regen and tempAdjust decay (`doc/CSBwin-src/Code17818.cpp`).
7. **DSA integration**. Implement `STKOP_ExperiencePlus` → `AddToSkill` and `STKOP_SetAdjustSkillsParameters` for AdjustSkills filters (`doc/CSBwin-src/DSA.cpp`).
8. **Save/load parity**. Persist skills with tempAdjust/experience in save files (`doc/CSBwin-src/SaveGame.cpp`).
9. **Validation tooling**. Add debug hooks to log mastery/experience changes and compare against CSBWin traces for a few scripted actions.

Status:
- ✅ Steps 1–4 implemented: engine `DetermineMastery`, `AdjustSkills`/`AddToSkill`/`LevelUp`, DSA AdjustSkills filter + `STKOP_SetAdjustSkillsParameters`, skill increaser now calls `AdjustSkills`, and level‑up messages route via `onTextMessage` (`src/engine/skills.ts`, `src/engine/DsaSystem.ts`, `src/engine/ActuatorSystem.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ LastMonsterAttackTime tracking added (set on monster-hit path, stored in `PartyState`, passed into `AdjustSkills` gating).
- ✅ Wired throw + spell-cast UI to `AdjustSkills` (throw skill 10, wizard base skill placeholder, mana-cost-based exp) (`src/engine/Game.ts`, `src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ TenSecondUpdate mana regen + tempAdjust decay implemented (regen uses mastery + wisdom and stamina drain) (`src/engine/Game.ts`).
- ⚠️ Pending: refine spell skill selection once spell definitions are implemented, replace throw skill gain with CSBWin tables, and refine LastMonsterAttackTime source once monster AI is in place.

### Phase 9.75 — Magic casting parity (spell effects)
Goal: mirror CSBWin’s `CastMagic`/`CastSpell` pipeline and spell effects.

1. **Spell data model parity**. Load `SPELL` records from graphics `0x230` (spellID, skillRequired, byte5, word6) and expose `SPELL_PARAMETERS` in the engine (`doc/CSBwin-src/CSB.h`, `doc/CSBwin-src/CSBCode.cpp`).
2. **Casting entrypoint**. Implement `FillSpellParameters`/`CastMagic`/`CastSpell` flow, including incantation override decoding and error handling (keep incantation on “needs flask”) (`doc/CSBwin-src/Magic.cpp`).
3. **DSA spell filter**. Add `CallSpellFilter` behavior using `spellFilterLocation` and actuator type 47 to mutate spell parameters (`doc/CSBwin-src/Magic.cpp`, `doc/CSBwin-src/data.cpp`).
4. **Skill gating + XP**. Match mastery checks, wisdom-based failure loop, and `AdjustSkills` gains (`doc/CSBwin-src/Magic.cpp`).
5. **Class 1: potions**. Implement `GetFlaskInHand` and potion creation with strength calculation and UI updates (`doc/CSBwin-src/Magic.cpp`).
6. **Class 2: missiles**. Implement `CharacterThrowsSpell` → `LaunchObject` → `LaunchMissile` with timerWord8 packing, range/decay rules, and missile creation (`doc/CSBwin-src/Magic.cpp`).
7. **Class 3: light/utility**. Implement light/darkness, see‑thru walls, invisibility, party shield, footprints, Zokathra, and fire shield timers (`doc/CSBwin-src/Magic.cpp`, `doc/CSBwin-src/Attack.cpp`).
8. **Action disable time**. Use `word6` bits 10–15 to schedule `DisableCharacterAction` (`doc/CSBwin-src/Magic.cpp`).
9. **UI integration**. Replace the current TODO in the magic panel with the casting pipeline and reflect UI changes for failed/successful casts.
10. **Validation tooling**. Add a debug “spell trace” mode to log parameters, effects, and timers for comparison against CSBWin.

Status:
- ✅ CSBWin casting flow documented in `doc/CSBWIN_MAGIC_CASTING_REFERENCE.md`.
- ✅ Step 1: spell table parsed from graphics `0x230` and exposed to the engine (`src/renderer/csbwin/UITables.ts`, `src/engine/Game.ts`).
- ✅ Step 2: `FillSpellParameters`/`CastMagic`/`CastSpell` pipeline implemented (not merely
  stubbed): parameter overrides, incantation override decoding, spell-power validation,
  mastery gating with the wisdom failure loop, and the three spell-class branches
  (`src/engine/Game.ts`, `src/renderer/ViewportRenderer.ts`, `src/main.ts`).
- ✅ Step 3: DSA spell filter wired to extended features `spellFilterLocation` (`src/engine/DsaSystem.ts`, `src/engine/DungeonState.ts`, `src/data/SaveGameLoader.ts`).
- ✅ Step 4: mastery gating + experience award logic implemented for casts/fizzles (`src/engine/Game.ts`).
- ✅ Step 5: potion creation now mutates the empty flask record with type/strength (`src/engine/Game.ts`).
- ✅ Step 6: class‑2 missile spell launch wired to CSBWin range/decay rules (`src/engine/Game.ts`).
- ✅ Step 7: class‑3 light/utility spell timers and counters implemented (`src/engine/Game.ts`, `src/engine/TimerQueue.ts`, `src/engine/TimerSystem.ts`, `src/engine/Party.ts`).
- ✅ Step 8: action disable timers now use TT_11 with CSBWin busy‑timer scheduling (`src/engine/Game.ts`, `src/engine/TimerQueue.ts`, `src/engine/TimerSystem.ts`).
- ✅ Spell abort/fizzle/meaningless/flask messages now emit via message area (`src/engine/Game.ts`, `src/engine/ActuatorSystem.ts`).

### Phase 11 — Unify the messaging system (CURRENT PRIORITY)

Goal: replace the debug-helper message path with a faithful port of CSBWin's
`SCROLLING_TEXT`. Full spec extracted in **`doc/CSBWIN_MESSAGES_REFERENCE.md`**.

The problem: actuator texts, spell messages and level-up notices all call `updateDebug()`
(`src/ui/messages.ts`), a debug helper that pushes pre-split whole lines into the renderer
via `setMessageLines()`. Consequences, all confirmed:
- Messages carry embedded `\n`, forcing hard breaks where CSBWin word-wraps one logical line.
- They render in the wrong colour (CSBWin uses colour 4 for spell messages).
- They **never expire** — CSBWin drops each row 70 ticks after it is drawn.
- No row management: CSBWin fills 4 rows top-to-bottom then scrolls up.

1. **Build the scrolling-text core** (new module, e.g. `src/ui/ScrollingText.ts` or
   `src/renderer/csbwin/ScrollingText.ts`). Port from `doc/CSBwin-src/CSBCode.cpp:1422-1600`:
   - `m_futureLines` queue of text pieces (`row`, `col`, `color`, `printLinesCount`).
   - `clockTick()`: place pieces, set `textTimeout[row] = time + 70` (or `+700` when the
     party sleeps), apply the monotonic clamp against the row above.
   - `removeTimedOutText()`: clear the row rect, reset timeout to -1, defer while scrolling.
   - `createNewTextRow()` / `scrollUp()` row management.
   - `resetTime()` for save/load rebasing.
2. **Port the tokenizer** `PrintLines` (`doc/CSBwin-src/CSBCode.cpp:1674`): word wrap at 53
   columns, 2-column indent on continuation, single-space handling, LF → new row (guarded by
   `column != 0 || row != 0`).
3. **Two-stage queue**. `quePrintLines(color, text)` enqueues; the game loop drains one entry
   per iteration into `printLines()` (mirrors `doc/CSBwin-src/CSBCode.cpp:716`).
4. **Convert every caller to fragments.** Emit `printLinefeed()` then append fragments —
   do *not* pre-join with `\n`. Start with `SpellErrorMsg`
   (`doc/CSBwin-src/Magic.cpp:1004`) and the level-up message in `ActuatorSystem`.
   Colour 4 for spell messages; `Byte1386[champion]` for name fragments.
5. **Draw from the index buffer** at the CSBWin geometry (rows at `y = 172 + i*7`, text at
   `x = col*6`, `y = row*7 + 177`), replacing `setMessageLines()`.
6. **Separate the debug log.** `updateDebug()` should write only to the DOM `#log` panel
   (i.e. become `appendLog`), never to the in-game message area. Reserve the message area
   for real gameplay text.
7. ⏳ Deferred deliberately: the pixel-level scroll animation
   (`d.PushTextUp` / `d.TextScanlineScrollCount`). Land instant row scrolling first and
   record here when the animation is added.

Status:
- ✅ Step 1: `ScrollingText` ported (`src/renderer/csbwin/ScrollingText.ts`) — future-lines
  queue, `clockTick`, per-row 70/700-tick timeouts with the monotonic clamp,
  `removeTimedOutText`, `createNewTextRow`/`scrollUp`, `discardText`, `resetTime`.
- ✅ Step 2: `PrintLines` tokenizer ported — 53-column word wrap, 2-column continuation
  indent, single-space handling, LF-guard.
- ✅ Step 3: two-stage queue (`quePrintLines` → `pump()` → `printLines`), pumped once per
  game tick from `main.ts`. Deviation: CSBWin's main loop drains one fragment per iteration
  at well above the clock rate; our pump runs at the 4 Hz tick, so it drains the whole queue
  at once. Equivalent, because `printLines()` ends with a `clockTick()` regardless.
- ✅ Step 4: callers converted to fragments. `SpellErrorMsg` and `StandardSpellMessage`
  (colour 4) in `src/engine/Game.ts`; `LevelUp` (per-champion colour `d.Byte1386`) and room
  text (colour 15, no explicit linefeed — the decoder prepends it) in
  `src/engine/ActuatorSystem.ts`. Engine emits through an injected `MessageSink`
  (`printLinefeed()` / `quePrintLines()`) rather than CSBWin's globals, so the engine stays
  independent of the renderer.
- ✅ Step 5: drawn from the index buffer at CSBWin geometry; `setMessageLines()` and the
  `messageLines` field are gone from `ViewportRenderer`.
- ✅ Step 6: `updateDebug()` now writes only to the external `#log` div, which was made a
  bounded auto-scrolling region. The in-game area is reserved for gameplay text.
- ✅ Verified against CSBWin semantics with a throwaway harness: fragment messages produce
  one wrapped line (previously four hard-broken ones), 4-row fill-then-scroll, exact 70-tick
  expiry, monotonic clamp, leading-LF room text, and 53-column wrap with 2-column indent.
  Deliberately not kept as a test — there is no test framework yet (Phase 15 should adopt
  these cases as its first tests).
- ⏳ Step 7 deferred as planned: the pixel-level scroll animation (`d.PushTextUp` /
  `d.TextScanlineScrollCount`) is not implemented; rows scroll instantly, and the guards
  CSBWin uses to wait for that animation are absent.
- ⏳ Also deferred: `SCROLLING_TEXT::Serialize` (message state in save games,
  `doc/CSBwin-src/Data.h:1666`). Quick-load currently calls `discardText()` instead, so
  tick-based timeouts can't be left stale by a clock jump.
- ⏳ `d.PartySleeping` is plumbed (`setPartySleeping`) but never set — no sleep system yet.

### Phase 13 — Champion lifecycle

Reference: **`doc/CSBWIN_CHAMPION_LIFECYCLE_REFERENCE.md`** — the attribute model,
`AddCharacter`, `KillCharacter`, the Vi altar, reincarnation, potions and pit falls,
with citations. Read it before touching any step below.

The phase was audited against CSBWin in September 2026 and re-ordered: three of the
original steps turned out to be largely done already, and the rest turned out to share
one missing primitive.

#### Prerequisites

0. ✅ **The `ATTRIBUTE` triple.** `CHARDESC.Attributes[7]` is seven
   *(maximum, current, minimum)* byte-triples (`doc/CSBwin-src/CSB.h:2409-2435`,
   `:2565`), not seven numbers. `src/engine/attributes.ts` ports it, including
   CSBWin's byte-wrap and its "above 240 means negative" read
   (`doc/CSBwin-src/data.cpp:1695-1741`), `AddCharacter`'s initial values
   (minimum 30, 10 for Luck, cap 224 — `doc/CSBwin-src/Character.cpp:640-659`) and
   `AdjustCurrentAttribute` (`doc/CSBwin-src/Character.cpp:3900-3934`).
   `tools/dump-attributes.ts` asserts all of it against the real mirrors.

   This was a prerequisite for nearly everything else in the phase — reincarnation
   penalties, the four attribute potions, the red box around the eye, the stats-panel
   colours — and it **fixed a live bug**: `levelUp` raised what was effectively
   *current* where CSBWin raises *maximum* (`doc/CSBwin-src/Magic.cpp:98-148`), so a
   level gain silently healed the attribute instead of opening a gap. It also closed
   the ⚠️ in `isCharacterLucky`, which had no min/max to clamp against, and replaced
   the `attrMax = attrValues.slice()` placeholder in the stats panel, where the
   red/green colour logic had been comparing a value with itself.

   The quick-save format went to v3; older quick-saves are refused, not upgraded.

1. ✅ **`AdjustStamina`** (`doc/CSBwin-src/Code11f52.cpp:4413`) —
   `MonsterAttack.adjustStamina`. Subtracts (so a negative value restores), clamps to
   `[0, MaxStamina]`, and turns any overshoot below zero into
   `DamageCharacter(chIdx, over/2, 0, 0)`. Wanted by step 6 and by anything that tires
   a champion.
2. ✅ **`SelectMagicCaster` and `d.GameIsLost`** — the two missing outcomes of
   `KillCharacter`'s tail. `selectMagicCaster` is in `Party.ts` beside `setHandOwner`,
   and `PartyState.gameIsLost` is set when the search finds nobody. The tail now runs
   CSBWin's own loop, skipping `potentialChampionIndex` — a new field, always -1 until
   Phase 13 step 4 sets it. `Game.onChampionDied` no longer blanks the magic tab, which
   would have undone the hand-off.

   This turned up a **real bug and fixed it**: `Party.getPartyChampion` resolved a
   champion by matching `partyPosition`, which is `CHARDESC.charPosition` — the corner
   of the cell, which `setPartyFacing` rotates. Every consumer of `cursorOwner` and
   `magicCasterIndex` reads them as list indices, and so does CSBWin
   (`d.CH16482[chIdx]`), so after the party turned, `setHandOwner(party, 1)` validated
   whichever champion had drifted into corner 1. It is now a plain list index, and
   `killCharacter` passes one.

   ⏳ **The same conflation survives in `src/renderer/ui/MagicPanel.ts:204-206`**, which
   both writes `magicCasterIndex = champion.partyPosition` and picks the rune-control
   rectangle by `partyPosition`, though the four boxes do not rotate. Left alone here
   because it is a UI change that wants the golden frames re-examined, not because it
   is right.
3. ✅ **Poison as a timer.** `TT_75` is ported: `poisonCharacter` deals
   `Larger(1, strength/64)` unmitigated damage and arms the next tick 36 ticks out
   carrying the remaining count; `TimerSystem.processPoisonTimer` drops `poisonCount`
   and calls back in, so the count sits at 1 for the whole illness; `curePoison`
   deletes the champion's pending `TT_75` timers, and `killCharacter` calls it. Before
   this, `poisonCount` only ever went up.

   `tools/dump-champion-state.ts` covers all three (36 checks) and caught a real defect
   while doing it: `schedulePoison` called `addTimer` after
   `createTimerWithUByte5`, which queues the entry itself, so two copies fired in the
   same pass and poison ran at double rate.

#### Steps

1. ✅ **Death.** Ported in Phase 12: `killCharacter` drops the possessions, creates the
   `value = 2` bones record at the champion's own cell position, and registers the
   bones↔champion mapping through `Game.registerChampionBones()`.
   ⏳ Still missing: the **character-death filter** DSA (`ESL_CHARDEATHFILTER`,
   actuator type 47, `doc/CSBwin-src/Character.cpp:2535-2589`) that runs before
   anything else.
2. ✅ **Item naming.** `getObjectDisplayName` prefixes the champion's name to the bones
   (`src/renderer/ui/Objects.ts:203`), matching
   `doc/CSBwin-src/Character.cpp:3549-3580`. Only actually reachable since the
   `misc_Boulder` mix-up under step 3 was fixed: the objects it tests for were never
   being created.
   ⚠️ It resolves the fingerprint against the *live party* only; CSBWin's
   `CHARDESC::CopyCharacter` also searches the wings (`:5239`), which we do not have.
3. ✅ **Resurrection at the Vi altar.** The `TT_VI_ALTAR` three-state timer is ported
   (`src/engine/TimerSystem.ts`), and the four gaps this step carried are closed:
   - state 2 now calls `CreateCloud(RNffe4)` over the bones
     (`doc/CSBwin-src/Timer.cpp:2730`), so the resurrection is visible;
   - `reviveChampion` became `bringCharacterToLife` and does the whole of
     `doc/CSBwin-src/Character.cpp:804` — the free-`charPosition` search when theirs is
     taken, and `facing = partyFacing`;
   - `findViAltarChampionIndex`, which guessed, is deleted. State 1's second arm reads
     `chIndex = DB10A2->value()` (`Timer.cpp:2789`) — for bones with no expool record
     the `value` field **is** the champion index, which `src/core/constants.ts` already
     said and nothing acted on;
   - the same two arms are now in the drop handler that *schedules* the timer
     (`Mouse.cpp:894-960`). `maybeScheduleViAltar` had only ever tested
     `value == 2`, which is the fingerprint arm's rule; a dungeon-authored bones object
     aimed at any champion but index 2 could not be placed in the altar at all.

   ⏳ **The wings are still absent** — CSBWin resolves a fingerprint that matches
   nobody in the party through `CHARDESC::GetFromWings`, heals that champion to
   `MaxHP/2` and saves them back (`Timer.cpp:2769-2782`). This port has no store of
   champions who have left the party, so there is nothing to search; the bones are left
   on the floor rather than silently destroyed. `Party.findChampionByFingerprint` is
   the one place that would grow the second half, and it names the gap.

   Along the way: three ad-hoc copies of `CHARDESC::CopyCharacter`'s party search
   (`TimerSystem`, `Game`, `Objects.ts`) collapsed into that one function, and the two
   copies of `CharacterAtPosition` into one — they had already drifted, `AddCharacter`'s
   omitting CSBWin's `HP() != 0` test. That omission was load-bearing in the opposite
   direction: without it a revived champion matches *themselves* and every
   resurrection relocates, and a full party sends the free-corner search off the end.

   `tools/dump-vi-altar.ts` drives both arms, the refusal of a living champion and the
   corner search (20 checks). It found **a real bug before it could even run**:
   `MonsterAttack.ts` declared its own `MISC_BONES_OF_HERO = 25` next to the correct
   `5` in `src/core/constants.ts` (`doc/CSBwin-src/Objects.h:192`), so every champion
   who died left a **boulder** (`misc_Boulder = 25`). Nothing downstream recognised it:
   the bones never took the champion's name (step 2, believed done), and the altar
   could never accept them — the entire death → altar → resurrection path was dead, in
   a step marked as working.

   **Reincarnation is not here** — it belongs to the Hall of Champions, step 4.
4. ✅ **Character creation.** `main.ts`'s `addCharacterFromPortrait`, which dropped a
   preset hero straight into the party, is gone. `Game.addCharacter` ports
   `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) and
   `Game.resurrectReincarnateCancel` ports `_ResurrectReincarnateCancel`
   (`doc/CSBwin-src/CSBCode.cpp:6615`); the actuator hook is wired inside `Game` now, so
   the tools reach it too. Done:
   - `potentialChampionIndex` — the "almost but not quite added" state. It gates the
     mouth (`Character.cpp:4061`) and, through the click dispatcher
     (`Mouse.cpp:1578-1650`), the portrait boxes, the inventory buttons, the magic panel
     and the attack panel. That is the only thing making the menu modal — CSBWin has no
     mode flag for it.
   - The Resurrect/Reincarnate/Cancel menu: `drawResurrectMenu` (`TAG0189a8`) blits
     graphic 40 and sets `displayResurrectChestOrScroll = 5`, which is what
     `Mouse.ts`'s `tag01a6ea` (`CSBCode.cpp:8500`) switches on to turn a click on button
     id 81 into a `buttons18372` hit. The chest arm of the same function moved with it.
   - **Reincarnate**: all 20 skills wiped, the hero's own
     `reincarnateAttributePenalty`/`reincarnateStatPenalty` charged (`DM_rules` is false
     by default, `data.cpp:251`, so they do apply), then 12 random attribute points —
     hardcoded in CSBWin, *not* the `randomPoints` field it parses.
   - **Cancel**: the champion is popped, `SetHandOwner(-1)` if they were the only one.
   - The mirror cell's objects as possessions, through CSBWin's `switch`/`goto case9`
     slot search — including the fall-through that makes slot 6 unreachable.
     `AddCharacterPossession` deliberately leaves them linked in the room; Resurrect
     `RemoveObjectFromRoom`s them, Cancel does not, which is what makes the undo clean.
   - Disabling the portrait actuator afterwards, with the `BlockDisables` rule.
   - The fingerprint from `(partyLevel<<10)|(partyX<<5)|partyY`. `Game`'s invented
     `nextChampionFingerprint` counter is deleted; `assignChampionFingerprint` now
     derives it the same way for every champion, including those loaded from a save.

   Along the way `HeroExtractor` was made faithful where it had been approximate:
   `statNumbers` is now `DecodeCharacterValue` (`'A'`..`'P'` only, `Character.cpp:414`)
   where it used to accept `'A'`..`'Z'` and build nonsense hex, the MAXHP/MAXSTAMINA/
   MAXMANA clamps are applied, and `reincarnateAttributePenalty`/`reincarnateStatPenalty`
   are parsed off the end of the skill letters. All 24 shipped heroes still parse and
   take the 2/8 fallbacks.

   `tools/dump-hall-of-champions.ts` drives the whole flow through `handleWallClick` at
   the real level-0 mirrors of HALK, BORIS, WU TSE and AZIZI (133 checks, including the
   edge-decoration geometry below). Verified in
   the browser too: menu, Cancel, Resurrect, and the spent mirror refusing a second
   click.

   ✅ **The mirrors show the champions' portraits** (playtest follow-up, strictly a
   rendering job rather than part of the phase). `SummarizeRoomInfo` was already
   computing `championPortraitOrdinal`; nothing consumed it. Now
   `StdDrawWallDecoration` passes it to `drawWallDecoration`, which was restructured
   into CSBWin's own two independent halves — frame under `graphicIndex >= 0`, portrait
   under `relativePosition == 12`, early return only when *both* are absent — and
   `drawChampionPortrait` blits the 32x29 cell out of graphic 26 with transparent colour
   **1**, so the glass shows around the head. `d.Byte2546`, the destination rectangle, is
   now extracted from graphics.dat item `0x22e` where the parser previously skipped it;
   the canary is CSBWin's own recorded `0x60,0x7f,0x23,0x3f`. Written up in
   `doc/CSBWIN_DECORATIONS_REFERENCE.md`, and verified in the browser at four mirrors
   plus the distance and spent-mirror cases.

   ✅ **`ReIncarnate` is ported** (`doc/CSBwin-src/Code13ea4.cpp:20`) —
   `src/renderer/ui/ReIncarnate.ts`, the UI's first **modal** screen. CSBWin writes it
   as one blocking `RESTARTABLE` loop; here the state lives on `UIState`, the draw
   rebuilds it from that state each frame, and the key and click handlers are the body
   of the loop. While `ui.reincarnate` is set, `Mouse.ts` hands it every click *before*
   the button lists (which would have discarded them as unmatched) and `ui/events.ts`
   hands it every key, so 'W' types a letter instead of walking the party into a wall.
   There is no cancel, because CSBWin offers none.

   The engine side splits to match: `ReIncarnate` is the **first** thing button 161
   does, before any penalty, so `resurrectReincarnateCancel` now stops there and
   `reincarnateNamed` runs the rest — skills, penalties, the twelve points, and the
   message, which prints the *new* name. With no UI attached the engine simply stops
   where CSBWin would be waiting, which is what `tools/` drives.

   Two tables the `0x232` parser had been skipping are now extracted: `d.SpecialChars`
   and `d.Byte1414`. Both came out exactly as the C++ predicts — `,|.|;|:| ` and `"_"` —
   with the known-good `byte1412` unchanged beside them, which is the offset canary.

   `tools/dump-reincarnate-entry.ts` (40 checks) drives the state machine. The load-
   bearing one is reading **every key centre of the grid out in order** and requiring
   the unbroken alphabet: the grid arithmetic has three traps — dead pixels between the
   keys, a carriage-return key that answers to two codes (86 and 97), and the shift by
   one that closes the gap it leaves — and getting the third wrong leaves a keyboard
   that still works but types the wrong letter from `W` on. Verified in the browser end
   to end: menu → Reincarnate → type → OK → "ZED REINCARNATED", the box and magic panel
   renamed, the mirror spent.
   - `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6540-6612`) is
     not ported. It only fires when the actuator carries a `DisableMessage`, a CSB
     extension the shipped DM dungeon never uses; the `actuatorType(0)` half is done.
   - `pcA3->talents` (`Character.cpp:688`) is parsed by CSBWin and dropped here —
     `Champion` has no field for it.
   - The `legalHero` fallback (`Character.cpp:475`) is not ported. CSBWin clamps a hero
     text that overflows MAXHP/MAXSTAMINA/MAXMANA or carries an out-of-range letter,
     marks it illegal and retries against its built-in "BOGUS / ILLEGAL HERO" string;
     `HeroExtractor` rejects such a hero outright, so a third-party dungeon with a bad
     hero text gets no champion where CSBWin would give a bogus one. No shipped DM hero
     is affected.
   - The portrait bitmap still comes from our own `portraitGraphic` path, not
     `TAG0088b2`'s copy into `CHARDESC.portrait`; external portraits for `charID > 23`
     are not supported (`GetExternalPortraitAddress`, a CSB extension no shipped DM hero
     uses).
   - **F8 (random party) is still there.** Its stated justification — "the only way to
     get a playable party" — is now gone, so it can be deleted whenever the author
     stops wanting it for playtesting. Left in deliberately rather than removed in the
     same commit as the feature that replaces it.
5. 🔄 **Drinking potions.** `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4020-4497`)
   is ported as its two halves: `src/renderer/ui/Feeding.ts` derives a
   `FEEDPARAMETERS` block from the object on the cursor, and
   `src/engine/Feeding.ts` applies it, in CSBWin's order, through the `applyFeeding`
   UI hook. All ten acting potion types work, the Ya potion arms its `TT_72`
   expiry timer (newly ported), and a lethal `hitpointAdjust` goes through
   `KillCharacter`. `tools/dump-feeding.ts` drives it over the **real potion records
   in `dungeon.dat`** (47 checks).

   `PotionType` in `src/core/constants.ts` was a guessed enum with eight invented
   members and the wrong values; it is now transcribed from
   `doc/CSBwin-src/Objects.h:14-37`, and the two files that had each written their own
   local constant use it.

   ⏳ **The Feeding Filter DSA is not ported** (`:4288-4344`). The insertion point is
   marked in `handleMouthPress`; no dungeon we load defines `ESL_FEEDINGFILTER`, and
   the parameter marshalling is its own job.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping, and CSBWin's incremental
   `CHARDESC.load` update — `characterLoad` re-sums instead, as it already did.
6. ✅ **Pit fall damage + stamina drain**, for party and monsters
   (`doc/CSBwin-src/Code11f52.cpp:3016-3106`). The pit branch of
   `TimerSystem.resolveCellEffects` now damages what falls through it:
   `DamageAllCharacters(20, 48, 2)` plus sound 6 for a free fall, a per-champion
   `AdjustStamina(25*load/MaxLoad + 1)` when `supressPitDamage` is set, and
   `DamageMonsterGroup(rec, oldX, oldY, 20, …, noItem16)` for a monster group — at the
   cell it fell *from*, because nothing is relinked until the resolver returns.
   `climbDownIntoPit` sets the flag through `withSupressedPitDamage`, and the fall
   clears it, so only the first drop of a chain is free.
   `tools/dump-pit-fall.ts` drops a party down a real pit in the shipped dungeon
   (12 checks).

   This turned up **a second real bug in the Phase 12 damage chain**: `damageCharacter`
   was missing CSBWin's `P4 == 2` branch, which halves the *armour* before the
   `130 - armour` scaling (`doc/CSBwin-src/Character.cpp:2780`). Every fixture in the
   tools is unarmoured, where `0 >> 1` is still 0, so nothing had shown it. It affects
   pit falls and both cloud damage paths.
7. ✅ **The eye and mouth boxes are drawn.** `drawMouthAndEyeBoxes`
   (`src/renderer/ui/Inventory.ts`) ports both blits of
   `doc/CSBwin-src/Character.cpp:1363-1392`: graphic **34** in place of **33** for the
   mouth when `food < 0`, `water < 0` or poisoned, and for the eye when any of
   attributes **1..6** has Current < Maximum. Luck is index 0 and CSBWin's loop starts
   at 1, so it can never mark the eye. Both go into `d.Word1398` / `d.Word1406`, which
   were already extracted, with transparent colour 12 so the icon shows through.

   The "red square on level gain" is answered and is **not level-specific**: a level
   raises the maxima (`Magic.cpp:98-148`) and leaves Current behind, and a drained
   champion shows the identical box.

   ⚠️ **The golden frames cannot see this**, and said so: all five were byte-identical
   after the change, because graphic 33 is the same pixels as the background beneath it
   and the frames only ever capture a fed, undamaged party.
   `tools/dump-status-boxes.ts` (28 checks) covers it instead — both rectangles out of
   `graphics.dat`, both graphics measured and proved to *differ*, and every arm of both
   predicates. Verified red in the browser too, at a champion made starving, poisoned
   and Strength-drained at once.

   One transcription trap worth keeping: `BLT2Viewport(…, 16, 12)` is a **16-byte
   source stride** (32 pixels) and transparent colour 12 — not a 16x12 image. The boxes
   are 18x18 on screen, and 18 pixels padded up to whole bitplane groups is what makes
   the stride 32. Passing the visible width as the stride would skew every row.
8. ✅ **The rest of `KillCharacter`'s tail** (`doc/CSBwin-src/Character.cpp:2670-2694`)
   — done as prerequisite 2. The cursor and the magic tab both move to the first living
   champion, `gameIsLost` is set when there is none, and `CurePoison` runs on the
   corpse.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping (`CHARFLAG_*`), which this port
   has no equivalent for — the renderer redraws from state every frame.
9. ✅ **`handChar` is read from the save block.** The GAMEBLOCK2 offset was never
   unknown — CSBWin's struct comments give the whole 128-byte layout
   (`doc/CSBwin-src/SaveGame.cpp:107-133`): `handChar` at 20, `MagicCaster` at 22.
   `parseBlock2` reads both, `saveSaveGameState` writes both, and
   `applySaveGameState` takes an optional party and assigns them the way `LoadGame`
   does (`:1636-1637`) — **directly**, not through `SetHandOwner`/`SelectMagicCaster`,
   which validate and rewrite facing. The layout is now written up in
   `doc/CSBWIN_SAVEGAME_REFERENCE.md`.

   Establishing the offset turned up **the reason a real DM save could not have been
   read anyway**: the whole block codec was little-endian. CSBWin never says the file
   is big-endian in words, it says it in `LE16`s — `Unscramble`'s hash arithmetic
   (`doc/CSBwin-src/CSBCode.cpp:9057`), `ReadUnscrambleBlock`'s (`:9083`) and every
   `BO()` in `swapBlock2` (`SaveGame.cpp:455`) — and `LE16` is a byte swap on the
   little-endian build CSBWin ships as. Reader and writer agreed with each other, so
   every checksum matched and the round trip was perfect, in a format no other program
   could read. Blocks 1 and 2, `ITEM16`, the characters and the timers are now
   big-endian; the CSB "Extended Features" header stays little-endian, because
   `SwapExtendedFeaturesBlock` is a no-op unless `_bigEndian` (`SaveGame.cpp:275`). The
   quick-save format went to v4 — old quick-saves are refused, not upgraded.

   `tools/dump-savegame-blocks.ts` (22 checks) is the first test the binary half has
   ever had; `dump-savegame.ts` only ever covered the runtime JSON. A round trip cannot
   see a byte order, so the tool differences two saves instead: `scramble`'s keystream
   depends on the hash and word index but never on the content, so changing
   `handChar` from 2 to 3 must move **byte 21** of block 2 and nothing else, where a
   little-endian writer would move byte 20. It caught a second defect on its first run:
   the `ITEM16` writer wrote bytes 2, 3 and 12-15 only, dropping each record's `word0`
   and its whole 4-11 middle, so a save carrying only these blocks lost its monster
   groups. Masked until now because the runtime half also carries `dungeon.item16` and
   is applied after.

Status: ✅ **done.** Every prerequisite and all nine steps are ported.

What remains against the phase is a short list of deliberate deferrals, each recorded
against its step above and none of them reachable in the shipped DM dungeon:

- the three DSA filters — `ESL_CHARDEATHFILTER` (step 1), `ESL_FEEDINGFILTER` (step 5)
  and `PortraitTranslateDisable`'s `QueueDSASwitchAction` (step 4). No dungeon we load
  defines any of them, so none could be verified if written;
- **the wings** (step 3): CSBWin's store of champions who have left the party, which the
  Vi altar and `CopyCharacter` both consult. This port has no such store at all, so it
  is a feature to build rather than a branch to port;
- `pcA3->talents`, the `legalHero` fallback and external portraits for `charID > 23`
  (step 4) — CSB extensions or clamps for malformed hero texts, all unused by DM;
- `charFlags` redraw bookkeeping (steps 5 and 8), which a renderer that redraws from
  state every frame has no equivalent for.

### Phase 14 — Structural cleanup

Goal: undo the drift that makes each new port harder than the last.

1. ✅ **Split `ViewportRenderer.ts`** — 3809 lines down to 723. The shared state it used to
   own is now an explicit `UIState` context (`src/renderer/ui/UIState.ts`) that the new
   modules take as their first argument, mirroring how CSBWin's UI files reach into
   globals. Each module is named after its C++ counterpart so the two stay greppable:
   - `ui/Mouse.ts` — the click ring buffer, the `word0` button dispatcher, the cursor
     (`Mouse.cpp`)
   - `ui/HitTest.ts` — `searchButtonList` / `pointInRect`, the leaf both Mouse and the
     panels depend on
   - `ui/Inventory.ts` — inventory screen, open chest, the eye's object-info panel, scrolls
     (`CSBUI.cpp`)
   - `ui/Character.ts` — portraits, hand icons, life bars, attributes, food/water, load,
     possession slots (`Character.cpp`)
   - `ui/Feeding.ts` — the mouth button and its chew animation (`Character.cpp`)
   - `ui/MagicPanel.ts` — rune keypad, incantation, mana cost, attack buttons (`Magic.cpp`)
   - `ui/Objects.ts` — name index resolution, description phrases, weight,
     `DetermineMastery` (`Objects.cpp`, `Code17818.cpp`)
   - `ui/Light.ts` — torch/magic light totals → viewport palette index
   - `ui/Draw.ts` — screen-buffer primitives and the static chrome
   - `ui/ViewportPicking.ts` — reverse lookup of a click against the frame's blit records
   `ViewportRenderer` keeps what the plan asked it to keep: initialisation, palettes, the
   wall / floor-ceiling bitmap caches, `render()`, present and blit-to-screen — plus thin
   public wrappers over the mouse and picking entry points the host page calls.
2. ✅ **Debug scaffolding removed from shipping paths.** ~450 lines moved out of `main.ts`
   into `src/dev.ts` behind a `DevHost` of live getters; `main.ts` went 899 → 401 lines.
   F5/F9 (quick-save/load), F8 (random party) and F7 (attack panel) are now gated on
   `isDebugFeaturesEnabled()` like F6/F10 already were, and the boot-time quick-load is too
   — with Debug off the game boots into a fresh dungeon.

   ⚠️ **Deferred, deliberately:** these were *not* deleted, as the plan's wording suggested.
   F8 is currently the only way to get a playable party (Phase 13's hall-of-champions flow
   does not exist yet; only `addCharacterFromPortrait` does); delete it when that lands.
   F5/F9 are **permanent**, not scaffolding — they are the functional equivalent of the
   original save menu and stay whether or not it is ported (Phase 10).
3. ✅ **Fallbacks and placeholders resolved or marked.**
   - The invented English movement strings are gone, along with the `message` field on
     `MovementResult` and the `message` parameter of `MovementCallback`. A blocked move now
     answers with `SoundIndex.WALL_BUMP` only, as CSBWin does. `checkSpecialTiles()` existed
     only to produce those strings and was deleted.
   - `DEFAULT_ROOM_TIMER_FUNCTIONS` moved to `src/engine/roomTimers.ts` with a note that the
     authoritative table is `graphic232.byte1596` (CSBWin `Data.h:1403`) and that the literal
     is only a pre-wiring fallback.
   - `Game.recordSpellCast()` was dead code carrying a `skillNumber = 3` placeholder; the
     live `castMagic` path already uses the spell record's `byte5`, as CSBWin does
     (`Magic.cpp:1396`). Deleted.
   - Stale TODOs in `DrawViewport.ts` ("implement complete viewport buffer system", "draw
     champion portraits", "handle see-through walls") described work that has since landed;
     replaced with what actually happens and where.
   - Still marked, not fixed: `computeThrowSkillGain` is missing CSBWin's
     `+ weaponDesc->uByte3 / 4` term (`Mouse.cpp:724-736`) because `weaponDesc` is not
     plumbed into the engine; `tag008c98Index` is an unverified behavioural approximation of
     `TAG008c98`.
   - **`PLAN.md` was wrong** about the throw skill: `AdjustSkills(chIdx, 10, …)` is literally
     what CSBWin does (`Mouse.cpp:737`), so there is no table to replace. Only the
     experience term above is short.
4. ✅ **Retired the JavaScript proof-of-concept.** `static/js/`, `static/index.html` and
   `static/style/` deleted together — they were one self-contained unit and nothing else
   referenced them. The sound sample rates survive in `doc/PROVEN_FACTS.md`, and the two doc
   references to the old files now say they were retired here and are recoverable from git
   history.
5. ✅ **De-duplicated shared constants.** `MISC_BONES_OF_HERO` → `src/core/constants.ts`
   (with its CSBWin citation), `DEFAULT_ROOM_TIMER_FUNCTIONS` → `src/engine/roomTimers.ts`.

**Bug found and fixed along the way:** `context.seeThroughWalls` was hardcoded `false`, so
the See-Thru-Walls spell had no visible effect even though the engine maintained the counter
(`Magic.cpp:1314` increments it, `TT_73` decrements it). `render()` now feeds it per frame,
as CSBWin's `SeeThroughWalls` opcode expects (`Viewport.cpp:2638`). Still unported: CSBWin
also recolours a near door while the effect is active (`CSBCode.cpp:4171-4174`).

**How this was verified.** `tsc --noEmit` clean at every step, and each of the twelve commits
byte-compared five live screen states against a golden baseline
(`tools/check-frames.sh`) — boot, party injected, inventory open, a selection inside it, and
the attack panel. Every frame stayed identical through the whole split. Interaction is
covered only to the extent the probe clicks: the inventory open/select path runs through the
new `ui/Mouse.ts` dispatcher, but throwing, dropping, chests, feeding and casting are not
exercised.

Status: ✅ completed.

---

### Phase 12 — Monsters: AI, movement, combat

Goal: port `doc/CSBwin-src/Monster.cpp` and the attack pipeline in
`doc/CSBwin-src/Attack.cpp`. When this phase opened it was the single largest remaining
gap — there were **no active monsters at all**, only their rendering. Both halves of combat
now work; see `doc/CSBWIN_MONSTERS_REFERENCE.md` and `doc/CSBWIN_ATTACK_REFERENCE.md`.

Several systems already carry proxies waiting on this phase; each must be revisited here:
- `LastMonsterAttackTime` is fed from the missile-hit path instead of real monster attacks
  (gates `AdjustSkills` scaling).
- Monster attack rendering is triggered from the renderer rather than from combat logic.
- Monster teleport rotation/position logic and monster teleporter sounds are stubs.
- `Game.registerChampionBones()` exists but is never called automatically.
- Attack panel (Phase 7 item 14) cannot show real actions without `PossibleAttackTypes`.

All five are now retired — see step 6.

1. ✅ **Monster data model.** The audit found all three records truncated or misread, and
   they are now field-for-field transcriptions of CSBWin (see
   `doc/CSBWIN_MONSTERS_REFERENCE.md`):
   - `MonsterDesc` went from 4 fields to the whole 26-byte `MONSTERDESC`
     (`CSB.h:2256`) with named `word2`/`word4`/`word14`/`word16`/`word18`/`word20` bit
     accessors, plus CSBWin's zero-`movementTicks06` clamp (`CSBCode.cpp:10163`).
   - `Item16Record` went from 3 fields to the whole 16-byte `ITEM16` (`CSB.h:2190`) —
     `word0` and all the movement state the AI needs.
   - `CreatureRecord` now mirrors `DB4`: `creatureType` masked to 5 bits with
     `alternateGraphics` split off, `count` renamed to CSBWin's `numMonM1` and stored as
     count-minus-one, `positions`/`groupIndex?` collapsed into the single dual-purpose
     `groupIndex`, and `fear`/`invisible`/`drawAsSize4`/`unique`/`poisoned` added.
   - The attack tables `parseGraphic230` used to skip over are extracted:
     `experienceForAttacking`, `skillNumber`, `byte20090`, `byte20046`, `byte20002`,
     `byte19958`, `byte19914`, `attackNames[300]` and `legalAttacks[44]`.
   - `MonsterType`, `StateOfFear` and `ATTACKTYPE` transcribed into
     `src/engine/monsterTypes.ts`; timer types 29-41 and `TT_M1`/`TT_M2`/`TT_M3` added
     to `TimerFunction`.

   **Three real bugs fell out of the audit**, all recorded in `doc/PROVEN_FACTS.md`:
   `numMonM1` was read as a count by the renderer and as count-minus-one by
   `TimerSystem`/`Game`; `getMonsterRenderState` could never reach an `ITEM16` because
   the `groupIndex?` field was never assigned by any loader, so monster attack and mirror
   flags were dead even when loading a save; and `ViewportPicking` read positions
   straight off `DB4` instead of the render state.

   Verified with `tools/dump-monster-tables.ts` (new) — the attack names read `BLOCK`,
   `CHOP`, `PUNCH`, … in `ATTACKTYPE` order, which pins the graphic `0x230` offsets — and
   all five `tools/check-frames.sh` frames stayed byte-identical.
2. 🔄 **Monster timers and movement.**
   - ✅ **Group lifecycle** (`src/engine/MonsterSystem.ts`): the `ITEM16` pool with
     CSBWin's two different growth caps, `AttachItem16ToMonster`, `DetachItem16`,
     `TAG00bd40`, `ProcessMonstersOnLevel`, `InitializeItem16`,
     `NextMonsterUpdateTime`, `StartMonsterMovementTimers`,
     `DeleteMonsterMovementTimers` and `EnsureItem16Available`.
   - ✅ **`LoadPartyLevel`** wired: monsters are detached and re-attached whenever the
     party changes level, and the check runs immediately before `processTimers` at
     each of the four call sites, as CSBWin orders it (`CSBCode.cpp:618-635`).
     Restoring a save re-derives the pool (`SaveGame.cpp:1240-1244`).
   - ✅ **Timer types 29-41 routed** out of the dispatcher ahead of the switch, as
     CSBWin does (`CSBCode.cpp:6422`).
   - ✅ **`QueueSound` ported** (`src/engine/SoundQueue.ts`) — the engine can now name
     a sound by ordinal instead of raw SND id. ⚠️ Two gaps: `deltaTime > 1` should
     defer the sound as a `TT_20` timer (`CSBCode.cpp:1832`) but plays it at once,
     and `SoundFilter`'s DSA hand-off (`Sound.cpp:670`) is not ported.
   - ✅ **Dev AI trace** on F4, formatted after CSBWin's `AITraceActive` output.
   - ✅ **`MoveObject` for monsters** (`MonsterSystem.moveMonster`): monsters now use
     the same teleporter and pit resolution the party does, via
     `TimerSystem.resolveMonsterDestination` over the shared `resolveCellEffects`.
     Includes `CheckMoveFromMissile` on the way out, the `ITEM16` attach/detach when
     crossing levels, AI-timer retargeting, `ClearAttacking_DeleteMovementTimers`,
     and the `d.MonsterDamageResult` global that decides whether a missile encounter
     aborts the move.
   - ✅ **Abeyance** (`TT_60`/`TT_61` + `ProcessTimer60and61`): a group whose
     destination holds the party or another monster is parked and retries every 5
     ticks, with Lord Chaos's 25%-chance random step so he can escape a walled-in
     corner.
   - ✅ **`InitialChecks`** and `ProcessTimers29to41`'s prologue
     (`src/engine/MonsterAI.ts`), with the timer-helper chain CSBWin factored its
     `goto`s into: `SetMonsterTimerB`, `Set_Monster_Timer`, `EnsureI60NonZero`,
     `Increment_Time_By_W52_Plus_Random`, `Delete_Timers_Maybe_Set_Fear`,
     `MaybeDelTimers_Fear6_TurnIndividuals`, `Turn_Monsters_As_Group` and
     `StartBGroupTimer`. CSBWin's `d.` scratch globals are gathered into an explicit
     `AiScratch`.
   - ✅ **`d.freezeLifeTimer`** and **`d.Word11694`** (game won) added as real state,
     with the per-tick countdown (`CSBCode.cpp:684`).
   - ✅ **`ProcessTimers29to41`'s decision body** — the TT_29/30/31 reaction
     branches, the A-family and B-family timer paths, and the whole movement chain:
     `Try_Directions_D5_To_D4`, `Try_Preferred_Direction_Then_Others`, `Try_To_Move`,
     `D4D0Finish`, `TryUByte67`, `Process_Invincible`,
     `Process_Invincible_And_Finish` and `Standard_Finish`.

   **Monsters now move, hunt and flee.** Verified with `tools/watch-monsters.ts`
   (new): on level 2 with the party at (6,14), most of the 22 groups move over 600
   ticks and none ends up inside a wall; the two groups adjacent to the party both enter
   fear state 6 — the break-formation-and-attack state — and close to distance 1,
   while distant groups stay in state 0 and wander; and the nearest group's path
   `(6,13) → (7,13) → (7,14)` shows the pre-melee position shuffle. Six new entries
   in `doc/PROVEN_FACTS.md`, including the fear-state table.

   - ✅ **`CheckMonsterVersusMissiles`** (`Monster.cpp:4462`) — a monster shuffling to
     another corner of its cell now walks onto any missile already sitting there.

   ⚠️ **One deferral:** `CreateMovementTimer`'s overflow guard is not ported — CSBWin
   counts the groups already waiting at a square and, past 31, deletes the monster
   unless it is `Unique()` or carries something (`Code11f52.cpp:2474-2510`).

   Verified with `tools/dump-monster-move.ts` (new): an Ant Man moved from (1,16) to
   (2,16) leaves the old cell, appears in the new one, and its AI timer follows it
   rather than staying behind, while its `ITEM16` records (2,16) and remembers
   (1,16); a move onto an occupied square yields exactly one abeyance timer carrying
   that monster; and the abeyance timer correctly reschedules while blocked, then
   places the group once the destination clears.

   Verified with `tools/dump-monster-activation.ts` (new): on level 3 the real
   dungeon activates 13 groups — worms in the corridor at (2,1)-(6,1), munchers,
   rock piles, a Rive — each with exactly one AI timer whose `uByte5` is
   `255 - movementTicks06` for its type, and every DB4 pointing back at its own slot.
   All five `tools/check-frames.sh` frames unchanged.
3. 🔄 **AI / targeting.**
   - ✅ **Perception and movement probing** (`src/engine/MonsterPerception.ts`):
     `BlockedTypeA`, `StoneOrClosedFalseWall`, `TestDirectPathOpen`, `Blocked`,
     `GetBestMonsterFacingP1`, `PossibleMove`, `FindPossibleMove`,
     `PossibleDoubleMove`, `TurnMonster`, `TurnMonsterGroup`, plus
     `IsItInThisDirection`, `GetPrimaryAndSecondaryDirection`, `RelativeXY` and
     `DistanceBetweenPoints`. `PossibleMove`'s six `d.` output globals are gathered
     into an explicit `MoveProbe`.
   - ✅ **The footprint trail** (`src/engine/PartyFootprints.ts`): `d.PartyFootprints`
     + `d.Byte13220` with `AddFootprintEntry`, `DeleteFootprintEntry` and
     `SearchFootprints`, recorded at every party relocation. This is the smelling
     mechanism, and it did not exist before — only a `numFootprintEnt` counter did.
     CSBWin's author calls `AddFootprintEntry` broken; it is ported as written,
     because it is the sole writer of the age bytes smelling reads.
   - ✅ **`DoorCharacteristics[4]`** extracted from graphic `0x22f` (absolute 9760),
     so `DoorTOC` is real data rather than a guess; `MonsterDroppings[40]` came with
     it.
   - ⏳ Still to do: the state machine — `InitialChecks`, `ProcessTimers29to41` and
     the `Try_To_Move` / `Try_Preferred_Direction_Then_Others` /
     `Try_Directions_D5_To_D4` / `Standard_Finish` / `Process_Invincible` chain — and
     the Monster Move Filter DSA that wraps it.

   **Dependency found while reading `InitialChecks`** — it changes the order the rest
   of this phase has to be done in. `InitialChecks` cannot be finished before
   `DamageMonster` exists: its first real act is to sweep the group for a member at
   zero HP and call `DamageMonster` to remove it, re-queueing its own timer and
   bailing out if anyone died (`doc/CSBwin-src/Monster.cpp:2802-2832`). It also needs
   the monster form of `MoveObject` for the off-party-level random walk (`:2908`). So
   the remaining work is *not* "step 3 then step 4" — it is:

   1. ✅ `MoveObject` for monsters — **done**, see step 2 above.
   2. ✅ `DamageMonster` — **done**, see step 4 below.
   3. ✅ `InitialChecks` — **done**, with the timer-helper chain.
   4. ✅ `ProcessTimers29to41`'s decision body and the `Try_*` chain — **done**.
   5. ✅ `MonsterAttacks` + `MonsterDamagesCharacter` + champion death/bones — **done**.
   6. ✅ Creature generators — **done**, see step 5.
   7. ✅ The champion melee pipeline from `Attack.cpp`, with the real attack panel —
      **done**, see step 7.

   Verified with `tools/dump-monster-perception.ts` (new): on level 2 with the party
   beside a nest of Ant Men, the three at ranges 1-3 see it and the ones beyond do
   not (Ant Man `sightDistance` is 3); the one standing one cell away but facing
   north is correctly blind to a party to its south while smelling it in the right
   direction; and across all 22 groups no monster ever reports a legal move into
   stone. Eleven new entries in `doc/PROVEN_FACTS.md`.
4. 🔄 **Attack resolution.**
   - ✅ **`DamageMonster`** (`src/engine/MonsterDamage.ts`) with `DeleteMonster`,
     `DropMonsterRemains`, `CreateAndDropObject` and the four packed-byte accessors
     `MonsterPositionByte` / `SetMonsterPositionByte` / `MonsterFacingByte` /
     `SetMonsterFacingByte`. This was done ahead of the rest of the phase because it
     is both a hard prerequisite for `InitialChecks` and the one piece that retires a
     stub already live in the shipping path.
   - ✅ **`Game.applyMissileDamageToMonster` retired.** The missile system now goes
     through the real `DamageMonster`, so a hit produces the death cloud, the
     droppings, the dropped possessions, the survivors' fear reaction and the
     per-member timer renumbering — none of which the 35-line stand-in did.
   - ✅ **`TimerQueue.reprioritizeTimer`** added, mirroring CSBWin's
     `AdjustTimerPriority` (`Code11f52.cpp:1194`): the function code is part of the
     queue's sort key, so renumbering a per-member timer has to re-sort it.
   - ✅ **`Byte10340[4]` and `MonsterDroppings[40]`** extracted from graphic `0x22f`.
   - ✅ **`MonsterAttacks` and the champion damage chain** (`src/engine/MonsterAttack.ts`):
     the attack parameter block and its DSA filter hook, per-type missile selection,
     `LaunchMissile` for monsters, `MonsterDamagesCharacter`, `DamageCharacter` with
     wounds, `Quickness`, `IsCharacterLucky`, `TAG016426`, `GetCharacterToDamage`,
     `DetermineAttackOrder`, `PoisonCharacter` and `KillCharacter`.
   - ✅ **Champion death → bones → possessions dropped**, with
     `Game.registerChampionBones` now called automatically — retiring the proxy Phase
     12 item 6 named. `d.uByte590[4]` and `d.Byte586[8][4]` extracted from graphic
     `0x232`.
   - ✅ **`LastMonsterAttackTime` proxy retired** — it is now fed by `MonsterAttacks`
     itself rather than from the missile-hit path.
   - ✅ **`Attack.cpp` proper** — the champion's own attacks. See step 7.

   - ✅ **Armour now protects.** `TAG01680a` ported: shields held in either hand
     weighted per body part by `Byte1412`, the vitality-scaled random term, the
     champion's shield spell, the party shield, the champion's own attack-type
     modifier, and the garment worn on the struck part. `ClothingDesc.uByte1/uByte2`
     extracted from graphic `0x22f` and `Byte1412[6]` from `0x232`; bit 7 of
     `uByte2` marks a shield, verified as exactly the seven shields in the shipped
     data. Measured: one body piece cuts damage ~6%, a full suit ~18%.

   ✅ **Both divergences closed** by `src/engine/CharacterStats.ts`:
   - `TAG01680a`'s `DetermineThrowingDistance(chIdx, hand)` term
     (`Character.cpp:2416`) is in, so a shield too heavy for its bearer protects less.
     The full suit in `tools/watch-monster-attacks.ts` moved from 18% to 20%.
   - **`Quickness` uses load**: a champion carrying 504 against a 500 max load averages
     13.2, an empty-handed one 26.5 (`tools/dump-throwing.ts`).

   Verified with `tools/watch-monster-attacks.ts` (new): a four-champion party stood
   next to the monsters on level 2 takes its first hit at tick ~146, loses its first
   champion around tick ~160-240, and ends as four sets of `misc_BonesOfHero` with
   `value = 2` lying in the party's cell. A direct wound probe confirms the
   threshold-doubling mechanism: 163 of 200 hits of 300 damage wound (reaching all
   six body parts), 0 of 200 hits of 6 damage do. Eight new entries in
   `doc/PROVEN_FACTS.md`.

   ⚠️ **One divergence, deliberate:** `CreateAndDropObject` appends new weapon /
   clothing / misc records rather than reusing a freed slot as CSBWin's
   `FindEmptyDB5Entry` does. This matches what `Game.createMiscObject` and
   `DsaSystem`'s object copy already do; it is invisible in play but drifts object
   indices from CSBWin's, which matters only for Phase 10's binary-compatible saves.

   Verified with `tools/dump-monster-damage.ts` (new), four cases on the real
   dungeon: killing member 1 of a 4-strong Screamer group compacts HP
   `[100,110,120,130]` → `[100,120,130]` and status `[a0,a1,a2,a3]` → `[a0,a2,a3]`
   while its per-member timers go `[0,1,2,3]` → `[0,1,2]` and the group timer is left
   alone; the same group outside fear state 6 has its timers correctly untouched;
   killing a lone Mummy frees the `ITEM16`, clears the AI timers, removes it from the
   cell and makes exactly one death cloud; and a Screamer's remains come back as
   `misc` type 33, `misc_ScreamerSlice`, which confirms the `MonsterDroppings`
   range-split arithmetic. Seven new entries in `doc/PROVEN_FACTS.md`.
5. ✅ **Creature generators.** `CreateMonster` ported
   (`MonsterSystem.createMonster`): group size clamped by the type's footprint, per
   member hit points of `baseHealth * multiplier + Random(baseHealth/4 + 1)`, corner
   positions from a random start advancing by two for a two-corner monster, and
   placement through `moveMonster` so an occupied square sends the new group into
   abeyance. Actuator type 6 now spawns; `TT_REACTIVATE_GENERATOR` was already wired.
6. ✅ **Retire the proxies.**
   - ✅ `LastMonsterAttackTime` is fed by `MonsterAttacks`, not the missile path.
   - ✅ The renderer-side attack trigger is **deleted** — `onMonsterAttackState`,
     `handleMonsterAttackState` and `playMonsterAttackSound` are gone. The attacking
     flag is set by the AI and the renderer only reads it, so a monster attacking off
     screen is no longer silent.
   - ✅ `Game.registerChampionBones()` is called automatically from `KillCharacter`.
   - ✅ Monster teleport rotation and teleporter sounds are real (`moveMonster`).
   - ✅ The attack panel is real (step 7); the placeholder text and its F7 debug
     toggle are deleted.

7. ✅ **The champion's own attacks** (`Attack.cpp`). See
   `doc/CSBWIN_ATTACK_REFERENCE.md` for the whole shape.
   - ✅ **`src/engine/AttackSystem.ts`**: `_Attack`'s dispatch over all 44
     `ATTACKTYPE`s, `AttackWithPhysicalForce`, `DeterminePhysicalAttackDamage` with
     both damage rolls and the three special-cased blades, `PhysicalAttackFilter`,
     `DetermineAttackOrdinal`, `WarCryEtc`, `AttackWithSpell`,
     `DecrementChargesRemaining`, `SetCharToPartyFacing`, `FluxCage`,
     `IsCellFluxcage` and `IsLordChaosHere`. `ATTACKPARAMETERS` is kept as one block,
     as CSBWin does, because the Party Attack Filter is handed the whole thing.
   - ✅ **The Party Attack Filter** (`ESL_PARTYATTACKFILTER`): `SetupDSAParam` and
     `CallAttackFilter` via `DsaSystem.findPartyAttackFilter` /
     `callPartyAttackFilter`, called at `msg` 0, 1 and 2 with the same block mutated
     in place.
   - ✅ **`src/renderer/ui/Attack.ts`**: `ItemHasChargesLeft`,
     `GetLegalAttackTypes`, `PrepareAttack`, `_ExecuteAttack`, `TAG01b1c0`,
     `DrawAttackButton`, `DrawLegalAttackTypes`, `TAG019fac`, `TAG01b29a` and
     `_FlashAttackDamage`, over new `UIState` fields mirroring
     `AttackingCharacterOrdinal` / `PossibleAttackTypes` / `Byte20256` /
     `Word20248` / `Word20250` / `Word20252`.
   - ✅ **Supporting ports that were missing**: `CharacterThrowsSpell` and
     `LaunchObject` (`Magic.cpp:449`), `EnableCharacterAction` (`Timer.cpp:2638`)
     with the bow's auto-reload and the thrown weapon's hand refill (`TAG0115ee`,
     `TAG011594`, `TAG0153c2`), `RemoveCharacterPossession`, `TT_24` and
     `CreateFluxcage` (`Code11f52.cpp:1515`), `MagicShield`'s return value, and
     `ThrowByCharacter` with the filter's range/damage/decay overrides.

   **Four real bugs fell out**, all recorded in `doc/PROVEN_FACTS.md`:
   - **`CT_FLUXCAGE` is 50, not 7.** `MonsterPerception` was comparing against
     `CT_POISON`, so an invincible monster was stopped by a poison cloud and walked
     straight through a Fluxcage — the mechanism the Lord Chaos fusion depends on.
     The constants now live in `src/engine/cloudTypes.ts`.
   - **The party's turn never rotated the champions.** CSBWin adds the turn delta to
     every champion's `charPosition` *and* `facing` (`Code11f52.cpp:4085`); neither
     moved here, so a champion kept attacking in the direction the party faced when
     they joined, and the corner marker in their box rotated when it should not.
     Ported as `setPartyFacing` in `src/engine/Party.ts`, which the plain turn, the
     teleporter rotation and the pit shuffle now all go through — as in CSBWin, where
     all three are `MoveObject`.
   - **`charPosition` was doubling as the portrait slot.** `Character.ts`,
     `Inventory.ts`, `Feeding.ts` and `MagicPanel.ts` looked champions up by
     `partyPosition === chIdx`; CSBWin indexes `d.CH16482[chIdx]` directly, and once
     the corner rotates the two part company. All four now index by champion number.
   - **`ordinalOfMonsterAtPosition` existed twice and one copy was wrong.**
     `MonsterAI`'s iterated the group ascending and skipped CSBWin's parity walk-back
     for a two-corner monster. Extracted to `src/engine/monsterPosition.ts` and shared
     with `TimerSystem` and `AttackSystem`.

   Also added: `ClothingRecord.charges` (`DB6` bits 9-12), which no loader was
   reading, and `Game.setRandomSeed` so a whole-`Game` tool can pin `d.RandomNumber` —
   `watch-monster-attacks.ts` and `dump-clouds.ts` were unseeded and are now
   reproducible.

   ⚠️ **`dump-clouds.ts`'s half of that never took effect** and was only found when
   `tools/` was brought inside the type gate (Phase 15 step 1): its
   `game.setRandomSeed(0x12345678)` sat *after* a `return new Game(...)`, so it was
   dead code and every run drew a fresh `Math.random()` seed. Fixed; the tool now
   produces byte-identical output across runs.

   ⚠️ **Deferrals, all deliberate:**
   - **Lord Chaos's endgame** — `_Fusion` (`Attack.cpp:133`) and `_FusionSequence`
     (`:2220`). `atk_FUSE` runs its filter and does nothing else. It cannot be
     exercised until Lord Chaos works, so porting it now would land untested.
   - **`ActionNameFilter`** (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8680`) — the DSA that
     can rename an attack option. Option names come straight from `AttackNames`.
   - **`d.SupressPitDamage`** is not modelled, because the party's own pit-fall damage
     is not ported at all. `atk_CLIMBDOWN` moves the party down the pit through the
     normal `resolveCellEffects` chain and nothing is hurt — which is currently also
     true of falling in by accident.
   - **`_FlashAttackDamage`'s `VBLDelay(15)`** stops the whole game for a quarter
     second. The flash is a timed overlay of the same duration instead; the game keeps
     running underneath, as it already does for the feeding animation.
   - **`FluxCage`'s duplicated neighbour test** (`:1626-1630`) tests `(LCX, LCY-1)`
     twice and never looks south. Kept as written — it is what the real game does.
   - **`atk_SHOOT` overwrites the damage it computes** with the launcher's weapon class
     (`:1905-1906`). Plainly a bug in the original; kept.

   Verified with `tools/dump-player-attacks.ts` (new), seven cases on the real dungeon:
   a sword's menu reads SWING / PARRY / CHOP with mastery requirements 2 and 3 and a
   bare hand reads PUNCH / KICK / WAR CRY — the canary that pins the graphic `0x230`
   offsets; each of the four corners reaches a different member of a two-worm group;
   300 SWINGs by a mastery-4 champion land 213 blows for 798 damage against a mastery-8
   champion's 212 for 915, which is how we learned the hit check ignores skill
   entirely; a well-fed champion wipes a ~590-HP worm group in 115 swings; the two
   back-rank corners report "CAN'T REACH" on all 20 attempts and the front two never
   do; 60 SWINGs at a Rive deal 0 and 60 DISRUPTs deal 429; all five shouts frighten
   the group exactly when `base + mastery` can reach its bravery; and FREEZE LIFE steps
   70 → 140 → 200 → 200. Fourteen new entries in `doc/PROVEN_FACTS.md`. The
   `tools/check-frames.sh` attack frame is *deliberately* rebaselined — it used to
   capture the F7 placeholder and now captures the real menu.

**Scope note.** `Attack.cpp`'s Lord Chaos endgame — `_Fusion`, `_FusionSequence` — is
**deliberately deferred**: it cannot be exercised until both monsters and Lord Chaos work,
so porting it now would land untested. `FluxCage`, `IsCellFluxcage` and `IsLordChaosHere`
*are* ported, since they are reachable today. Validation is `tools/dump-player-attacks.ts`,
`tools/watch-monster-attacks.ts` and `tools/check-frames.sh`, plus the dev-only AI trace
mirroring CSBWin's own `AITraceActive`/`AttackTraceActive` output so the two codebases stay
diffable; a real test framework stays Phase 15.

Status: ✅ done — steps 1-7 complete, with the deferrals listed under each step. What
remains of combat is not in this phase: the party's own pit-fall damage, the Lord Chaos
endgame (Phase 13's neighbour), and `CreateMovementTimer`'s overflow guard (step 2).

---

### Phase 15 — Verification (working notes for the finished steps)

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   twenty-five asserting tools, then four non-asserting dumps as crash-only smoke, then
   the frames with `--frames`. ~6s, ~17s with frames. Failures print the tool's whole output,
   because the table above a failed assertion is what says which way the port went wrong.
   Tools are listed in the runner with the arguments their assertions were written for.
   `tsx` is now a devDependency — the suite used to depend on `npx` fetching it.

   ✅ **`tools/` is inside the type gate.** `tsconfig.json` was `"include": ["src"]`, so
   `tsc --noEmit` — the thing this plan calls "the real gate" — never looked at the
   regression suite at all. Two errors slipped through in a single session before this
   was noticed: a call to a `setPlaySound` that does not exist, and a
   `TimerFunction.TT_1` that is spelled `TT_DOOR_STEP` here and therefore evaluated to
   `undefined`, so the timer was never dispatched and the tool silently measured
   nothing. Turning it on surfaced 34 errors; all are fixed. Of those, two were real:

   - `dump-clouds.ts`'s dead `setRandomSeed` (see Phase 12 step 7 above);
   - `watch-monster-attacks.ts`'s clothing fixtures never gained the
     `ClothingRecord.charges` field Phase 12 added to the record.

   The rest were unused locals plus twenty `Property 'timerSystem' is private`, which
   is now `readonly` and public like `timerQueue` and `monsterSystem` — the tools
   already drove it, TypeScript just could not see them doing it. `extract-graphics.ts`
   keeps its parked portrait-slicer setup alive with `void` references rather than
   deleting work that is only commented out.

   Came with `tools/lib/check.ts` (shared `check`/`fail`/`finish`, and `finish()` fails a
   run that made no checks) and with real assertions for the four tools that could not
   fail — see the ⚠️ under "Validation debt" above.
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` now starts its own dev
   server and headless Chrome (reusing ones already up), uses a throwaway Chrome profile,
   and takes `--update` to refresh the baseline; `tools/probe-frames.mjs` pins the viewport
   with `Emulation.setDeviceMetricsOverride`, which it did not before — the committed
   baseline was 1600x861 only because of the window decoration of the one browser that
   captured it, and every freshly started Chrome diffed on all five frames. The baseline
   was re-captured at 1600x1000 and verified byte-identical from both a fresh browser and
   the original one, so the *content* is unchanged.

   Still owed to make it a real test: a fixed set of *party positions* rather than whatever
   the boot dungeon gives, and rendering straight from the index buffer instead of a browser
   screenshot (no dev server, no Chrome).
3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. ⏳ **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: 🔄 in progress — steps 1 and 2 done; 3, 4 and 5 remain.

---

### Phase 16 — Title screen and dungeon entrance ✅

Goal: everything CSBWin does before the party is in the dungeon.

Done, in `src/renderer/intro/` (`IntroHost.ts`, `TitleSequence.ts`, `PrisonDoor.ts`,
`PrisonLevel.ts`, `BootSequence.ts`). Spec and citations:
`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`; evidence: `tools/dump-intro.ts` (103 checks) and
golden frames `07-entrance` / `08-credits`.

1. ✅ **The title animation** — `_DisplayChaosStrikesBack` (`CSBCode.cpp:9203`). CSBWin's
   name is Chaos Strikes Back's; the routine is the shared engine's and runs off graphic 1,
   so with DM's data it plays DM's title: "Presents" fades up and out, the "Dungeon" logo
   zooms from 48×12 to 320×80 over eighteen `ShrinkBLT` frames, then "Master" appears in red.
   `ShrinkBLT`'s 16.16 fixed point is transcribed, truncation and all.
2. ✅ **The dungeon entrance** — `_TAG01f746` / `_TAG01f5ea`. The corridor behind the doors
   is the real viewport renderer over a synthetic 5×5 level, as CSBWin does it, which is why
   `render` was split and `drawViewportFrame` extracted.
3. ✅ **The door animation** — `_OpenPrisonDoors`, 31 frames × 6 VBL, the grind every third
   frame, the eight pre-shifted door buffers, and the three-column sliver the right half
   leaves at the frame edge because 31 frames of 4 pixels is not quite 123.
4. ✅ **The credits scroll** — `_TAG01f928`, the hidden button 202. Rendering it turned up a
   **codec bug**: `decodeIMG` had been written from the dmweb.free.fr format notes rather
   than from `ExpandGraphic`, and three opcodes disagreed. Graphic 5 is the only image in
   either data set that uses one of them, so the scroll slid right from (78,55) on while
   everything else looked fine. `src/core/imageDecoder.ts` is now a transcription of
   `doc/CSBwin-src/CSBCode.cpp:10836`, and `tools/dump-image-codec.ts` checks it against
   `tools/reference/csbwin-credits.png` — a capture of CSBWin's own screen, and the only
   ground truth in this project that did not come out of our own code.
5. ✅ **"Resume"** — `openSaveMenu(ui, 'loadOnly')` on a cleared screen, which is what
   `SelectSaveGame(_9_, 1, 1, 1)`'s leading 1 asks for. Cancelling puts the entrance back up.
6. ✅ **The mouse pointer**, shown and hidden where `STShowCursor` / `STHideCursor` say. The
   arrow is blitted with no colour mapping at all, so the screen's palette decides its
   colour: index 4 is `0x654` beige against the entrance's stonework and `0x066` in the
   dungeon. `withCursor` is `DrawCursor` + `RemoveCursor`, so it never enters the picture.

Deliberately not ported, each with its reason in the reference doc: the
`QUIT/DUNGEON/UTILITY/HINT` launcher menu (one binary, one program), `DiskMenuNeeded` in the
entrance loop (unreachable — button 140 is not in `Buttons16932`), the low-memory guard at
`CSBCode.cpp:9222`, `_TAG01f928`'s never-reset 65535-VBL counter, and CSBWin's fallback where
"Resume" on an empty slot silently starts a new game (an unbounded list has no empty slots).

One genuine divergence, and it is a *narrowing* of one: CSBWin mutates `d.Word68` / `d.Word76`
in place while the doors slide and never restores them. This port walks local copies. The
doors open once per run, so the two are equivalent.

Open items from this phase are in `DEBT.md` → tier H (the intro's wall-clock time and `?intro=0`).

### Resolved debt (moved out of `PLAN.md`)

Entries that were carried as debt and are now closed. Any sub-item still open is listed in
`DEBT.md`; this is the surrounding context, not the status.

- ✅ **The level-3 monster timer stall — no longer reproduces.** Re-checked after
  Phase 12 closed: `npx tsx tools/watch-monsters.ts 3 10 25 200` runs the documented
  repro and the `50000 cap` warning never fires; 5 of 13 groups move and the Muncher
  at (11,29) walks its whole path to (9,25). The next-time computation the entry
  suspected (`Increment_Time_By_W52_Plus_Random` / `EnsureI60NonZero`) was ⏳ when the
  cloud work hit this, and was ported in Phase 12 step 2. Kept here as a record of the
  diagnosis; `tools/dump-clouds.ts` still uses level 2 and need not change.

  <details><summary>original entry</summary>

- 🐞 **The level-3 monster timer stall.** A `TT_MONSTER_AGROUP` timer for the group at
  (10,29) on level 3 re-queues itself at the tick it just ran on, so `processTimers`
  spins until its 50000-iteration cap and **every timer behind it never runs** — on that
  level the game effectively stops. Reproduce: put the party on level 3, run
  `processTimers` from tick 0, and watch the new `TimerSystem: timer pass … hit the 50000
  cap` warning fire on 199 of the first 200 ticks. The trace shows `Standard_Finish`
  reached with `timeUntilAlternateUpdate=0`, which suggests the next-time computation
  (`Increment_Time_By_W52_Plus_Random` / `EnsureI60NonZero`, `doc/CSBwin-src/Monster.cpp`)
  is producing a zero delay where CSBWin guarantees a positive one. Found while porting
  clouds: it was masking the cloud timer on that level.
  `tools/dump-clouds.ts` deliberately kills its test monster on level **2** to avoid it.

  </details>

- ✅ *(playtest)* **A thrown or shot object no longer stays in the hand as well.**
  `atk_THROW` launched the club *and* left it in the fighting hand, so the party got a
  second one by walking to where the first landed; `atk_SHOOT` did the same with the
  arrow, and `atk_FREEZELIFE` left a dangling reference to a magical box it had already
  deleted from the database. All three go through `Game.removeCharacterPossession`,
  whose `setPossessionDirect` wrote `possessions[slot]` and returned — never clearing
  the `shieldHand` / `weaponHand` / `quiver` mirrors, which is exactly what every reader
  falls back to when the array reads null (`src/renderer/ui/Character.ts:538`). The
  removal therefore removed nothing. Fixed by mirroring slots 0, 1 and 8 the way
  `setChampionPossession` and `DsaSystem` already do. `tools/dump-throwing.ts` section 7
  covers it, deliberately reading the hands back through the UI's own accessor — reading
  `possessions` directly would have passed while the club was still in hand.

  ⏳ The dual storage itself is the real defect and is still there: `Champion` keeps
  hands in both `possessions[0..1, 8]` and three named fields, and every writer has to
  remember both. Collapsing it to the array alone is a Phase 15 candidate.

- ✅ *(playtest)* **The eye panel prints the mastery ranks again.** "NOVICE FIGHTER" and
  its fifteen siblings were missing from the top of the attribute panel while the six
  attributes below them drew fine. `MASTERY_LABELS` in `src/renderer/ui/Character.ts` was
  an **empty array left in as an unmarked placeholder**, so the loop's
  `if (!masteryLabel) continue;` skipped every role silently. The names are
  `d.Pointer16770` (`doc/CSBwin-src/CSBCode.cpp:370-384`) — one of the rare tables that is
  genuinely hardcoded in CSBWin rather than extracted from `graphics.dat`. Two smaller
  faults went with it: the six master ranks start with `` ` `` and `a`..`e`, which are rune
  glyphs in font `0x22d`, so they need `drawTextLineIndexRaw` rather than the upper-casing
  `drawTextLineIndex`; and `getRoleMastery` dropped CSBWin's `0x8000`
  (`doc/CSBwin-src/Character.cpp:4593`), so a potion or spell could have moved the printed
  rank. Written up in `doc/PROVEN_FACTS.md`; `tools/dump-mastery-panel.ts` renders the real
  panel and byte-compares the lines, since no golden frame covers this panel.

  ⏳ **Other empty placeholder tables may be hiding the same way.** This one produced no
  warning and no marker — worth a Phase 15 sweep for arrays and tables that are
  initialised empty and read through a `continue`-on-falsy guard.

- ✅ *(playtest)* **A wall decoration one cell ahead and to the left is no longer cropped
  on the wrong side.** Position 7 (the F2 front-left wall) scales to the width of the F2
  *centre* rectangle and is then drawn into a narrower slot flush against the left border,
  so it must show the bitmap's **right** end — `srcOffsetX = finalBitmapWidth -
  (rect.x2 - rect.x1)` (`doc/CSBwin-src/CSBCode.cpp:3551`). The port computed no
  `srcOffsetX` at all, so it drew the left end instead: cropped on the wrong side, with
  the transparent margin that belonged off-screen showing as a gap from the border.
  Its mirror-image case, position 9, was accidentally right because there the offset
  really is 0. Found by playtest, standing one back and one right of a Hall of Champions
  mirror. Written up in `doc/CSBWIN_DECORATIONS_REFERENCE.md`.

  ⏳ **One deliberate non-port** in the same block: CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored far-right sidewalls
  (positions 1 and 6, `:3536`), compensates for `MakeMirror` reversing a byte-aligned
  buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would shift a
  correctly aligned image. Left out on purpose, with the reasoning in the code.

  ⏳ **No golden frame covers an edge decoration**, which is why this survived so long.
  `tools/dump-hall-of-champions.ts` now pins the geometry that makes position 7 special
  (both edge slots narrower than the bitmap; the front-left window ending flush with its
  right edge, the front-right starting flush with its left) across all 8 rect sets, but
  the pixels themselves are still verified only by screenshot. A sixth frame would want a
  way to place the party, which the probe has no affordance for.

- ✅ *(Phase 7 item 14)* **Attack panel** — done (Phase 12 step 7). `src/renderer/ui/Attack.ts`
  ports `GetLegalAttackTypes`, `PrepareAttack`, `DrawAttackButton`, `DrawLegalAttackTypes`,
  `_ExecuteAttack`, `TAG019fac`, `TAG01b29a` and `_FlashAttackDamage`. The F7 debug toggle
  and the placeholder text are deleted; the panel is driven by `word20250`/`word20252` as
  CSBWin drives it. One deferral: `ActionNameFilter` (`ESL_ACTIONNAMEFILTER`), the DSA that
  can rename an option, is not ported — names come straight from `AttackNames`.
- ✅ *(playtest)* **A closing door no longer passes through the party or a monster.**
  `ProcessTT_1`'s two blocker arms are ported (`doc/CSBwin-src/Timer.cpp:1289-1357`):
  the party springs the door fully open, takes `DamageAllCharacters(5, 4, 2)` and only
  then hears `soundDOOROPENING`; a monster takes `DamageMonsterGroup(…, 5)`, the
  survivors are poked with `TT_M3`, and the door steps back **up** one with sound 4.
  Neither existed — the door closed straight through both.

  The nesting was the trap and is written up in `doc/CSBWIN_MOVEMENT_REFERENCE.md`:
  `D4W != 0` guards the *party* arm alone, so a fully open up-down door still crushes a
  `VerticalSize() == 0` monster, and two of the 27 monster types in the shipped data
  are that size. Verified by `tools/dump-door-crush.ts`, which shows level 2's door
  stepping `1 → 0 → 1` over an Ant Man and the party losing 71 HP under it.

- ✅ *(playtest)* **Monsters block the party.** `MoveParty`'s monster arm is ported into
  `MovementSystem.handleMovement` — the `d.NumCharacter != 0` gate, the unfiltered
  `FindFirstMonster` (an immaterial monster blocks too), the silence, and
  `ProcessTimers29to41(x, y, TT_M1, 0)` so the group gets a turn out of being bumped
  into. Before this the party walked straight through every monster, which made every
  combat encounter escapable and every combat playtest measure the wrong game.
  Ref: `doc/CSBwin-src/CSBCode.cpp:8286-8304`, written up in
  `doc/CSBWIN_MOVEMENT_REFERENCE.md`. Verified by `tools/dump-party-collision.ts`.

  ⏳ **Three deferrals from the same block**, all pre-existing gaps rather than new:
  - The **wall-bump damage**: CSBWin answers a terrain-blocked move with
    `DamageCharacter(…, 1, 24, 2)` on up to two champions and only then queues sound 18
    (`:8288-8299`). We queue the sound unconditionally and nobody is hurt.
  - **`DiscardAllInput()` / `d.clockTick = 0`** on any inhibited move (`:8311-8315`).
    Not ported because `DiscardAllInput` drains CSBWin's raw keyboard and mouse queues
    (`:7532`), which is not obviously our 3-deep `movementQueue` — that mirrors
    `CSBUI.cpp`'s key queue. Establishing the mapping needs `CSBUI.cpp` read properly;
    guessing it would change how queued moves behave after every bump.
  - The **vertical-move guard** (`:8200-8204`), which refuses a Move Up / Move Down into
    a monster's cell outright. `MovementAction` has no up/down member, so there is no
    entry point to attach it to yet.

- ✅ *(Phase 9 step 11)* **`ThrowByCharacter` is ported.**
  `estimateThrowRange/Damage/Decay` are gone; range, damage and decay come from
  `DetermineThrowingDistance` and skill-10 mastery, in CSBWin's order — the throw raises
  the skill *before* the mastery that sets its range is read. The sound, the stamina cost
  (`TAG016382`) and the action disable came with it; they were missing entirely.
  Ref: `doc/CSBwin-src/Mouse.cpp:672-757`, `doc/CSBwin-src/Character.cpp:2267`.
- ✅ *(Phase 9 step 13)* **Clouds are alive.** `CreateCloud` now schedules the `TT_25`
  timer it always needed, and `ProcessTT_25` is ported in full: the death puff shrinks by
  40 a tick and is gone in 3-6, poison lingers ~85 ticks and hurts whoever stands in it,
  and a fireball bursts a door and vanishes. `CreateCloud`'s own blast damage came with
  it, along with `DamageMonsterGroup`, `DeterminePoisonDamage`, `DamageAllCharacters` and
  `HitDoor`, none of which existed. Verified by `tools/dump-clouds.ts`.
  Ref: `doc/CSBwin-src/Timer.cpp:436`, `doc/CSBwin-src/Code11f52.cpp:1376`.

  ⚠️ `HitDoor`'s `delay` argument is not ported — only the zero case is reachable, since
  the delayed form is `Attack.cpp`'s melee (`TT_BASH_DOOR`), which does not exist yet.
- 🚫 **Every death now goes through `KillCharacter`.** Two paths used to zero `health`
  and set `alive = false` by hand — the missile-hits-party stand-in and a duplicate
  `Game.adjustStamina` — so a champion killed by a missile or by exhaustion left no
  bones and no possessions, and a party wiped by either did not lose the game. Both are
  routed through `MonsterAttack.damageCharacter` now, `DetermineMagicDamage` is ported,
  and `tools/dump-champion-death.ts` checks all three paths produce the same six
  consequences. Closed, not debt.
- 🚫 **`charFlags` redraw bookkeeping** (`CHARFLAG_*`, steps 5 and 8) is not modelled
  and will not be: this renderer redraws from state every frame, so there is nothing
  for a dirty flag to gate.
- 🚫 *(Phase 6)* Custom skins / `BACKGROUND_LIB` skipped — the shipped DM dungeon uses no
  custom backgrounds. Revisit only if we ever load a third-party CSBWin dungeon.
- 🚫 The never-executed validation steps of phases 2, 4, 5 and 7 (render probe, scripted
  room-info checks, CSBWin screenshot comparison) are **all** folded into Phase 15 below.

#### Moved with the rest of the list on 2026-09-23

`PLAN.md`'s "Carried-over debt" section was replaced by `DEBT.md` on 2026-09-23. Its open
entries moved there; the resolved ones below moved here verbatim, together with two found
already fixed during the move.

- ✅ **Found resolved on 2026-09-23: `MagicPanel` conflated `partyPosition` with the champion
  index.** `handleMagicClick` now walks the champions by list index, the comment at
  `src/renderer/ui/MagicPanel.ts:203-206` records why, and nothing in the file reads
  `partyPosition` any more.

  <details><summary>original entry</summary>

- ⏳ **`MagicPanel.ts:204-206` still conflates `partyPosition` with the champion
  index** — it writes `magicCasterIndex = champion.partyPosition` and picks the rune
  rectangle the same way, though the four boxes do not rotate. The same bug was fixed in
  `Party.getPartyChampion` (Phase 13 prerequisite 2); this half was left because it is a
  UI change wanting the golden frames re-examined, not because it is right.

  </details>

- ✅ **Found resolved on 2026-09-23: "missile launch, monster creation and `WiggleEverything`
  still need concrete engine hooks".** All three are wired: `onSpawnMonster`
  (`src/engine/TimerSystem.ts:1476`, handled in `Game`), `launchMonsterMissile`
  (`TimerSystem.ts:1080`, reached from `MonsterAttack` through `Game`), and
  `wiggleEverything` (called from the teleporter and pit timers, `TimerSystem.ts:735`,
  `:760`). The TODOs the entry pointed at no longer exist.

  <details><summary>original entry</summary>

- ⚠️ *(Phase 8)* Missile launch, monster creation and `WiggleEverything` still need concrete
  engine hooks — see the TODOs in `src/engine/TimerSystem.ts`.

  </details>

- ✅ **Resolved: attributes raised by a level gain stayed red forever.** `LevelUp`
  raises only an attribute's Maximum (`doc/CSBwin-src/Magic.cpp:98-148`); Current is
  drawn back up one point every 256 ticks (64 asleep) by `TenSecondUpdate`
  (`doc/CSBwin-src/Code17818.cpp:384-414`). Our `processTenSecondUpdate` had only the
  mana and `tempAdjust` parts, and ran every 40 ticks instead of CSBWin's
  `(d.Time & (sleeping ? 15 : 63)) == 0` (`doc/CSBwin-src/CSBCode.cpp:686-688`). It
  is now fully ported: footprint aging, food/water consumption paid in stamina, HP
  regeneration (with the Ekkhard Cross bonus), attribute recovery and the facing
  reset. Food and water therefore now actually go down. Evidence:
  `tools/dump-ten-second-update.ts`. The `d.Word11750` countdown is not ported: it
  is a cursor-redraw counter set only by `CSBCode.cpp:959-965`, which has no
  counterpart here, so the branch is dead.

- ✅ **Resolved: dropping an object onto an active teleporter did not teleport it.**
  `DropObject` (`doc/CSBwin-src/Mouse.cpp:882`) always calls `MoveObject(objD4, -1, 0,
  x, y, NULL, NULL)`, the same teleporter/pit-resolution loop a walking party or
  monster goes through — `Game.dropObjectFromCursor` skipped straight to
  `DungeonState.addObjectToCell` on the raw drop target instead, so a "place the item
  on the plate" puzzle placed the item and nothing else happened.
  `TimerSystem.resolveDroppedObjectPosition` is the new public wrapper around the
  existing `resolveCellEffects` (already used by `wiggleObject`/the actuator path;
  nothing about the teleporter logic itself was wrong), and `dropObjectFromCursor`
  now lands the object wherever that resolves to.
  Evidence: `tools/dump-teleporter-drop.ts` finds a real active, item-scoped
  teleporter in `dungeon.dat`, drops a floor item onto it, and checks the item ends
  up at the destination rather than the drop cell — it fails on the pre-fix code.

- ✅ **Resolved: a thrown object landing on an active teleporter or a pressure plate
  did nothing.** `ProcessObjectFromMissile`'s no-monster arm
  (`doc/CSBwin-src/Timer.cpp:151-159`) is `MoveObject(objD6.pos(missile.pos()), -2, 0,
  mapX, mapY, NULL, NULL)` — the same call `DropObject` makes, which places the
  landed object through `PlaceOrRemoveObjectInRoom`
  (`doc/CSBwin-src/Code11f52.cpp:3438-3446`), the function that fires a pressure
  plate under whatever just arrived. `TimerSystem.dropMissileObject` did neither: it
  called `DungeonState.addObjectToCell` on the raw landing cell with no teleporter
  resolution and — this is the one that actually bites, since a missile's own
  in-flight movement already resolves any teleporter it flies through
  (`moveMissileToCell` → `resolveCellEffects`) — no actuator trigger at all, so a
  puzzle solved by throwing an item onto a plate you cannot stand on (or cannot walk
  to, with a pit in the way) never fired. Now calls the same
  `resolveDroppedObjectPosition` the cursor-drop fix uses, then
  `ActuatorSystem.triggerObjectMove` at the landing cell.
  Evidence: `tools/dump-missile-drop.ts` throws a floor item at a real teleporter and
  at a real floor actuator in `dungeon.dat`; the actuator-trigger check fails on the
  pre-fix code (the teleporter check does not, in isolation, only because the
  in-flight path already covered it — kept anyway since it is what CSBWin's own
  `MoveObject` call does at that point, and it is the one that matters when a throw's
  range runs out exactly on the landing cell rather than mid-flight).

- ✅ **Resolved: a thrown object that hit a closed door landed on the far corner of
  its cell, half a cell past where it should sit** — reported by the author as
  fully reproducible for every closed door, both orientations: throw at a closed
  door, open it, and the item sits at the back corner rather than the front one; a
  save/load round-trip keeps it there, so it is a database misplacement, not a
  rendering artifact. `MissileTimer` computes two different positions on the tick a
  door blocks the flight (`doc/CSBwin-src/Timer.cpp:370-377`): an advanced `curPos`
  it threads through `ProcessMissileEncounter` as `objectPos` (used for a shattered
  potion's cloud placement and for `MissileEncounterFilter`), and the missile RN's
  own `.pos()` bits, which the `leavingThisCell` write that would normally advance
  them never runs on this path (it is gated on `leavingThisCell`, which is false
  here) — so `ProcessObjectFromMissile` (`Timer.cpp:156-157`, `objD6.pos(missile
  .pos())`) drops a plain weapon or misc item at the corner the missile was already
  resting at, one hop short of `objectPos`. `TimerSystem.processObjectFromMissile`
  had collapsed these into one value, dropping at the threaded-through `objectPos`
  for every caller. It now derives the drop corner from the missile RN's own stored
  position instead of a passed-in `posInCell`, matching CSBWin's split; the same fix
  also corrects a latent twin of the same bug for a missile that runs out of range
  exactly as it flies off the edge of the map (`nextRoomType` 8/exterior), which had
  been using the advanced position too.
  Evidence: `tools/dump-missile-drop.ts` scenario 3 throws a floor item at a real
  closed door in `dungeon.dat`, records the missile's own resting corner the tick
  before the door blocks it, and checks the landed item sits at that exact corner.
  Fails on the pre-fix code (landed corner 0 where the resting corner was 3).

- ✅ **Resolved: the sound a thrown item makes on impact was often the wrong sample**
  — found by the author while verifying the corner fix above: a sword or torch
  sounded right, but corn, bread, cheese, an apple, a waterskin and scrolls all
  played an explosion, and a fireball's blast seemed to pick at random between an
  explosion, a "zap" like the door-opening spell, and a third, unidentified sound.
  `QueueSound(soundNum, x, y, dt)`'s `soundNum` is an **ordinal** into `d.sound1772`
  (`graphic232`'s sound table), resolved to an actual SND item, playback rate and
  distance falloff by table lookup — not a raw sound-resource number.
  `TimerSystem.playMissileImpactSound` (the tail of `ProcessMissileEncounter`,
  `doc/CSBwin-src/Code11f52.cpp:2101-2121`) and `playCloudSound` (`CreateCloud`,
  `Code11f52.cpp:1432-1447`) instead called `playSound` with a hand-picked
  `SoundIndex` graphics.dat item per branch, and two of those picks named the wrong
  item: a plain object's impact (`soundNum` 4, for anything that is not a weapon or
  a poison bolt) played `SoundIndex.FIREBALL_EXPLODE` — ordinal 5's sample, not
  ordinal 4's — and a small fireball/poison/lightning blast (`size<=80`, `soundNum`
  20) played `SoundIndex.SPELL_EXPLODE` — ordinal 13's sample, not ordinal 20's.
  Ordinals 5 and 20 turn out to resolve to the *same* SND item (537) at different
  volume falloff distances — a small blast is meant to be a quieter version of the
  same explosion, not a different sound — so this also likely explains the "random"
  third fireball sound the author heard: `SoundIndex.SPELL_EXPLODE`'s sample (545)
  standing in for it on the small-blast tick. Both functions now call
  `hooks.queueSound(ordinal, x, y, 1)` with CSBWin's literal `soundNum`, exactly as
  the door and teleport code already did elsewhere in `TimerSystem`.
  Evidence: `tools/dump-missile-drop.ts` scenario 4 throws a weapon and a misc item
  at a real closed door and checks the ordinal `queueSound` receives (0 and 4);
  `tools/dump-clouds.ts` throws a big and a small fireball and checks the same (5
  and 20). Both fail on the pre-fix code.

- ✅ **Resolved: the teleporter/energy shimmer never animated, for two independent
  reasons.**
  1. `GraphicRandom` (`doc/CSBwin-src/CSBCode.cpp:564`) is a C function-static, so
     its counter advances once per *process*, not once per draw call.
     `BytecodeInterpreter.graphicRandom` had reseeded to 12345 as an *instance*
     field, and `DrawViewport` builds a fresh `BytecodeInterpreter` every redraw, so
     every frame replayed the identical jitter sequence. Moved to a `static` field on
     the class so it persists across instances, matching the C static's lifetime.
  2. `Game`'s main loop paced itself with `requestAnimationFrame`, which browsers
     **fully suspend** — not merely throttle — the moment a tab is backgrounded or
     occluded, unlike `setTimeout`. CSBWin's own VBL timer (and with it `d.Time`, and
     the `GraphicRandom` counter that rides on every `DrawViewport` it triggers) never
     stops just because the window lost focus. Confirmed live: with the old
     `requestAnimationFrame` scheduling, an out-of-focus tab's tick loop measured
     **zero** further iterations over several seconds — it had died outright, not
     slowed down — while a `setTimeout`-paced version of the same loop kept
     advancing (throttled to roughly 1/sec while backgrounded, full rate once
     focused). That standing-dead loop, occasionally kicked back to life by whatever
     browser-internal event a mouse click or move triggers, is the whole story
     behind "changes only on mouse events." `gameLoop` now reschedules itself with
     `setTimeout` instead.
  CSBWin redraws the viewport once per game tick — `DrawViewport(d.partyFacing,
  d.partyX, d.partyY)` sits directly in the "for each tick of the clock" handler
  (`doc/CSBwin-src/CSBCode.cpp:638`) — and a tick is 15 VBL at normal speed, i.e. 4
  Hz; this port's own `GAME_TIMING.TICKS_PER_SECOND = 4` already matches that, so the
  shimmer should change about **4 times a second**, not ~1 Hz.

  **Both of the above were real, and neither was the actual bug.** The pressure-plate
  fix confirmed ticks were running; the shimmer was still frozen anyway. The real
  defect was arithmetic, not scheduling: `graphicRandom`'s `state * 0xbb40e62d + 11`
  uses JS's plain `*`, and `state` and the multiplier are each up to ~2^32 — their
  exact product needs up to 64 bits, more than a float64 mantissa's 53, so the
  multiply silently rounded away exactly the low bits `>>> 7 % n` reads. Every state
  the LCG could reach turned out to be a multiple of 4096 once rounded, so `% 32`
  (the teleporter's row jitter) and `% 2` (cloud/decoration mirror-flip, the same
  method) both always came out **0** — a redraw every tick, always painting the
  identical pixels, invisible on any single frame and only showing up as a sequence.
  `core/random.ts`'s own `CsbRandom.advance()` already had the fix and the comment
  explaining it (`Math.imul` truncates to 32 bits *before* rounding, matching C's
  `ui32` multiply exactly) — `graphicRandom` just didn't follow it. Fixed the same
  way, and the identical pattern turned up in `SaveGameLoader.ts`'s DSA checksum
  reader (`this.checksum * 0xbb40e62d + 11 + buf[i]`), fixed too; it is currently
  dead code (no dungeon this project loads defines a DSA, per the note below), so it
  had no test to catch it.
  Evidence: `tools/dump-graphic-random.ts` drives the LCG against an exact BigInt
  oracle from five seeds, then checks the specific failure mode directly — 64 draws
  of `% 32` from the class's own starting state must not land on one value. Fails
  on the pre-fix code (all draws land on 0); the `Math.imul` version spreads across
  26 of the 32 possible values.

- ✅ **Added: the "lightning door" energy shimmer was never ported at all** — not a
  bug in existing code, a missing feature. `DrawDoor`'s bit-10 branch of
  `d.DoorTOC[doorType]` (`doc/CSBwin-src/CSBCode.cpp:4156-4166`) redraws with a
  random mirror and a random vertical flip on every frame the door isn't bashed;
  `opStdDrawDoor` had no notion of `DoorTOC` at all and always drew the same
  bitmap. The shipped `dungeon.dat` sets the bit —
  `doorCharacteristics[3] == 0x5ff` — so any level whose `doorType0Index`/
  `doorType1Index` selects entry 3 has doors that should shimmer and silently
  didn't. `ViewportRenderer.drawViewportFrame` now resolves `context.doorTOC` from
  the level's door characteristics next to where it already resolved
  `doorGraphics`, and `opStdDrawDoor` rolls the mirror/flip through a new
  `BytecodeInterpreter.viewportRandom` — a dedicated `CsbRandom` instance, per
  CSBWin's own `d.RandomNumber`-swap around `DrawViewport`
  (`doc/CSBwin-src/Viewport.cpp:6706-6707`), so drawing a door can never perturb the
  sequence monster AI and combat depend on.
  Evidence: `tools/dump-door-lightning.ts` confirms the shipped dungeon actually
  sets the bit, then drives `opStdDrawDoor` directly across 40 redraws of the same
  closed door and checks the drawn bitmap doesn't sit at a single, frozen pattern.
  Fails on the pre-fix code (always 1 distinct pattern); passes with 13 of 40 draws
  distinct.

  **Left open:** whether the cloud- and missile-sprite mirror/flip randomization
  elsewhere in `BytecodeInterpreter` (`this.graphicRandom(2)` for `mirror`/`flip` at
  the cloud-drawing site) is even drawing from the right generator. `GraphicRandom`
  has exactly two call sites in all of CSBWin, both inside `DrawTeleporter` — nothing
  in cloud or missile drawing calls it, so that code's choice of `graphicRandom`
  over a `viewportRandom`-style `STRandomBool()` (or over reading a monster's own
  precomputed mirror bit, set once by game logic rather than re-rolled every frame —
  `NextMonsterUpdateTime`, `doc/CSBwin-src/CSBCode.cpp:5877-5941`, is a real example
  of the latter) was not verified while fixing this. Not touched here — it was
  discovered by contrast while tracing what `GraphicRandom` is and is not used for,
  not by anything reported broken, and changing it needs its own read of the actual
  cloud/missile drawing source first.

- ✅ **Resolved: moving the mouse changed the teleporter/door animation state, at
  mouse-input rate.** With both bugs above fixed, the shimmer visibly *worked* — and
  then turned out to advance on every `mousemove` pixel, far faster than the once a
  tick CSBWin actually redraws at. `ui/events.ts`'s mousemove handler called the
  same `renderView()` movement and ticks use, which always calls
  `ViewportRenderer.render()` → `drawViewportFrame()` → `DrawViewport`, consuming a
  `graphicRandom`/`viewportRandom` draw on every call. CSBWin's cursor is a
  sprite tracked independently of the dungeon redraw — nothing in its mouse handling
  calls `DrawViewport` — so the fix is a narrower `ViewportRenderer.refreshOverlay()`
  that recomposites the screen (cursor, hover highlights, every UI panel) over
  whatever `viewportIndexBuffer` already holds, without calling `drawViewportFrame`
  at all; mousemove now calls that instead of `renderView()`.
  Evidence: live in a real tab, counting calls separately — eight `hover` moves
  produced exactly eight `refreshOverlay` calls and zero additional
  `drawViewportFrame` calls, which kept advancing on its own from the tick loop only.

- ✅ **Resolved: the timer table leaked two slots on every save/load cycle.**
  `TimerQueue.restore` minted new indices above the highest restored one, on the
  reasoning — written into the comment — that CSBWin's `m_firstAvailTimer` free list
  "costs nothing but the numbering". It cost more: `LoadGame` is followed by
  `reloadAfterSaveGame`, whose `processMonstersOnLevel` deletes and re-creates the
  movement timers of every monster group on the party's level, so each load abandoned a
  slot per re-created timer — `csbgame7.dat` went 78 → 80 → 82 → … over five quick-loads,
  without bound. The free list is ported now: `addTimer` allocates at the cursor and
  walks it forward, `deleteTimer` lowers it, `shiftNext` frees the fired timer's slot as
  `GetNextTimerEntry` does, and `restore` derives the cursor from the holes rather than
  needing the `gb2.FirstAvailTimer` the file carries. `shiftNext` not freeing was a
  second bug in the same place: a fired timer's index stayed live to `getTimer`.

  <sub>Context: `doc/PROVEN_FACTS.md` → “The timer array has a free list, and a save
  carries its cursor”. Evidence: `tools/dump-save-roundtrip.ts`.</sub>

- ✅ **Resolved: champion titles missing their first character — and it is not a bug.**
  A reincarnated champion whose title was left empty. `_ReIncarnate` clears **one byte**
  of each field to start, `pChar->name[0] = 0; pChar->title[0] = 0;`
  (`doc/CSBwin-src/Code13ea4.cpp:57-58`) — not the array — and each keystroke advances the
  terminator. Type the name back and skip the title, and `title[0]` stays 0 with the old
  title's bytes 1..19 still behind it: `SHE DEVIL` becomes `\0HE DEVIL`. The name never
  shows it because retyping the same name overwrites the same bytes over padding that was
  already zero. So reincarnation was never ruled out; a *test* that types a title
  overwrites the remnant, which is why the saves made to provoke it came back clean.

  CSBWin prints the title as a C string (`TextToViewport(…, pcA3->title, false)`,
  `doc/CSBwin-src/Character.cpp:1338`), so it shows a **blank** title — what the player
  asked for. The reader is not corrected for it; `decodeCharField` now stops at the first
  NUL for the same reason, where it used to skip zero bytes and show `HE DEVIL`.

  A second path to the same byte exists and is a real off-by-one —
  `EditCharacterName`'s insert branch (`doc/CSBwin-src/Chaos.cpp:5323-5324`) shifts from
  `max_len` rather than the string's length, so `name[8] = name[7]` and `name[8]` *is*
  `title[0]` — but that is the editor, not the game.

  <sub>`doc/PROVEN_FACTS.md` → “A champion's title can lose its first character”.</sub>

**Dev scaffolding (Phase 14)**

- ✅ F8 (random party) is **gone**, and with it F4/F6/F10 — the monster AI trace, the
  missile trace and the five missile scenarios, all Phase 8/12 validation aids whose
  phases have landed. The deletion reached the engine: `TimerHooks.onMissileTrace`,
  `MissileTraceEvent` and the nine `emitMissileTrace` sites in `TimerSystem` had no other
  consumer, nor did `Game.debugLaunchMissileDelayed` /
  `TimerSystem.launchDelayedMissile`, nor `main.ts`'s `getAddCharacterTables` (`Game`
  builds its own). `MonsterSystemHooks.trace` **stays** — `tools/dump-monster-ai.ts`
  registers it. `src/dev.ts` is down to the F5/F9 quick-save from ~640 lines.
- ✅ F5/F9 (quick-save/load) **stay**, and are no longer gated on `isDebugFeaturesEnabled()`
  — they are not scaffolding to be removed but the functional equivalent of the original
  save menu, kept for their convenience whether or not that menu is ever ported
  (Phase 10). The boot-time restore in `main.ts` is still Debug-gated; that one *is* a
  dev convenience.
- ⚠️ `tools/probe-frames.mjs` used F8 to get a party, so all five non-boot golden frames
  were rebuilt. It now drives the real Hall of Champions through the public game API —
  stand at a mirror, `handleWallClick`, `resurrectReincarnateCancel(160)`, four times —
  which needs no scaffolding in the app at all. HALK is added first so champion 0 holds a
  weapon and frame 05 still exercises the weapon attack list rather than PUNCH/KICK/WAR
  CRY.
