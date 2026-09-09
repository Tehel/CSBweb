# dmweb – Completed Phase Archive

Full working notes for the phases that are **done**. Split out of `PLAN.md` so that the
live plan stays small — this file is reference material, read it only when you need the
detail of how a finished phase was actually carried out.

**`PLAN.md` remains the authority on status.** Every item in these archived phases that is
still open is also listed in `PLAN.md` under "Carried-over debt"; this file holds the
surrounding context for those items, not their status. If the two ever disagree, `PLAN.md`
wins and this file is stale.

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

