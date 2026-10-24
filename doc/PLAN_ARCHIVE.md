# csbweb – Completed Phase Archive

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

1. Implement a small loader for `graphics.dat` “graphic `0x22e`” and parse the `DATA` subregion that starts at `d.Byte7248+2` (see `doc/CSBwin-src/CSBCode.cpp:10249` and `doc/CSBwin-src/Data.h:1124+`).
2. From that decompressed blob, extract at least:
   - `wallRectangles[14]` (`Data.h:1253`) including byte fields (`uByte4..uByte7`) used by `BltShapeToViewport()`.
   - Related rectangle tables that opcodes reference (floor pits, teleporters, stairs, doors) as needed by the implemented opcode set.
3. Add a dev-only “dump tables” helper (e.g. `tools/dump-viewport-tables.ts`) to output JSON for inspection and regression checks.

Validation
- Cross-check extracted indices against CSBWin’s pointer functions:
  - `Viewport.cpp:2298` `StdRectanglePointers()`
  - `Viewport.cpp:2261` `StdBitmapPointers()`

Status:
- ✅ `wallRectangles[14]` + adjacent viewport rectangle tables extracted at runtime from `graphics.dat` item `0x22e` and wired into the interpreter (`src/renderer/csbwin/ViewportTables.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Extraction uses the packed tail layout declared in CSBWin `doc/CSBwin-src/Data.h:1199-1331` (graphic `0x22e`) and matches how CSBWin reads it (`doc/CSBwin-src/CSBCode.cpp:10249`).
- ✅ `StdRectanglePointers()` semantics are now represented directly in the interpreter (CSBWin `doc/CSBwin-src/Viewport.cpp:2298+`) so future opcodes can consume a single “rectangle pointer” value instead of guessed array indices.
- ✅ Dev tooling:
  - `tools/check-graphic-22e.mjs`
  - `tools/dump-viewport-tables.mjs`
- ✅ Extracted/wired `0x22e` tables (all `RectPos` byte-rects):
  - `teleporterRectangles[12]`, `DoorRectsF*[*]`, `DoorTrackTopRect[7]`, `DoorFrameRect[8]`, `CeilingPit[9]`, `FloorPitRect[12]`, `StairEdgeRect[8]`, `StairFacingDownRect[11]`, `StairFacingUpRect[11]`, plus CSBWin’s “see-thru” helpers (`Viewport.cpp:2405-2406`, `Viewport.cpp:2583-2594`).

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
2. Implement per-frame `Mirror()` behavior controlled by `(x + y + facing) & 1` (see `Viewport.cpp:6747+`):
   - Mirror floor OR ceiling buffers as CSBWin does.
3. Ensure the bytecode renderer assumes the same state (walls/objects blit “on top” of floor/ceiling).

Status:
- ✅ Floor/ceiling background composed into the palette-index viewport buffer using CSBWin’s section sizes (ceiling 29, black 37, floor 70) (`doc/CSBwin-src/Viewport.cpp:3334-3336`, `doc/CSBwin-src/CSBCode.cpp:10246-10247`).
- ✅ Per-frame parity logic implemented: `(x + y + facing) & 1` selects whether floor or ceiling is mirrored (`doc/CSBwin-src/Viewport.cpp:6747-6761`) and uses mirror-mode wall bitmaps for that frame.
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
- ✅ CSBWin `SummarizeRoomInfo` logic ported from `doc/CSBwin-src/Codea59a.cpp:225` (`src/renderer/csbwin/SummarizeRoomInfo.ts`), including door/stair edge-vs-facing classification and out-of-bounds `GetCellFlags` behavior (`doc/CSBwin-src/CSBCode.cpp:4674`).
- ✅ Added object-list queries and RN link traversal (`GetObjectListIndex`, `FindFirstObject`, `GetDBRecordLink`, `FindFirstDoor`) in `src/engine/DungeonState.ts`.
- ✅ Interpreter now consumes real `roomData` values for door state/index, cell contents, cell XY, and `HasDecoration`/wall-decoration position semantics (`doc/CSBwin-src/Viewport.cpp:2640-2650`) in `src/renderer/bytecode/BytecodeInterpreter.ts`.
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
- ✅ Door “frame/track” bitmaps loaded per wall set (`graphics.dat` indices `77..83` for wall set 0, per CSBWin `ReadWallBitmaps()` in `doc/CSBwin-src/CSBCode.cpp:2926`) and used by bytecode programs (`src/renderer/ViewportGraphics.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Stair graphic opcodes now compute CSBWin per-wallset indices (base `90 + wallSet*18`, per `doc/CSBwin-src/Code390e.cpp:117-127`) so stairs/pits can render using `StdGraphicToViewport`.
- ✅ `StdDrawRoomObjects` now draws non-monster room items (weapons/clothing/scrolls/potions/chests/misc) using CSBWin tables from `graphics.dat` (`0x22e`: `s5604`, `viewportPosition`, `smallOffsets`; `0x22f`: `ObjDesc.graphicClass`) and correct hex draw-order constants (`doc/CSBwin-src/Viewport.cpp:2618-2637`).
- ✅ `StdDrawDoor` now draws door panels using extracted door rect tables (`graphics.dat` `0x22e`) and CSBWin door-graphic selection derived from `Door1Type/Door2Type` (`doc/CSBwin-src/Code390e.cpp:180-199`, `doc/CSBwin-src/CSBCode.cpp:4199-4259`) (`src/renderer/bytecode/BytecodeInterpreter.ts`, `src/renderer/ViewportRenderer.ts`).
- ✅ Wall decorations + wall text are now rendered by the interpreter: decoration placement uses `wallDecorationPosition[8][13]` + `Byte4100[60]` from `graphics.dat` `0x22e` and per-level `WallDecorationTOC` bytes parsed after CELLFLAGs (`doc/CSBwin-src/CSBCode.cpp:5856-5873`, `doc/CSBwin-src/CSBCode.cpp:3189+`) (`src/renderer/csbwin/ObjectTables.ts`, `src/data/DungeonLoader.ts`, `src/renderer/bytecode/BytecodeInterpreter.ts`).
- ✅ Random floor decoration selection + actuator-driven floor decoration ordinals now populate `roomData.decorations[2]` for open-like rooms (`doc/CSBwin-src/Codea59a.cpp:299-351`, `doc/CSBwin-src/CSBCode.cpp:5761-5804`) (`src/renderer/csbwin/SummarizeRoomInfo.ts`).
- ✅ `StdDrawFloorDecoration` now renders floor decorations using `floorDecorDesc`, `RelativeCellGraphicIncrement`, and per-level `FloorDecorationTOC` (`doc/CSBwin-src/CSBCode.cpp:3845-4020`, `doc/CSBwin-src/Code390e.cpp:263-272`) (`src/renderer/bytecode/BytecodeInterpreter.ts`, `src/renderer/csbwin/ObjectTables.ts`).
- ✅ `StdDrawCeilingPit` now mirrors CSBWin `CheckCeilingPit`, drawing ceiling pit bottoms from the level above using `CeilingPit[9]` + hardcoded graphic indices (`doc/CSBwin-src/CSBCode.cpp:4274-4323`) (`src/renderer/bytecode/BytecodeInterpreter.ts`).
- ✅ Extended wall/floor decorations now load from `CSBgraphics.dat` and render via ReadWallDecoration/ReadFloorDecoration semantics (`doc/CSBwin-src/Graphics.cpp:3228+`, `doc/CSBwin-src/CSBCode.cpp:3129-3872`) (`src/data/CSBGraphicsLoader.ts`, `src/renderer/bytecode/BytecodeInterpreter.ts`, `src/main.ts`).
- ✅ Teleporter draw opcode now renders using `graphics.dat` `0x22e` teleporter descriptors (`DrawTeleporter`, `doc/CSBwin-src/CSBCode.cpp:4331`), with a CSBWin-style `TAG008c98` chunky port for mask/overlay blits.
- ✅ `DrawRoomObjects` now handles monsters/missiles/clouds in addition to items, using CSBWin tables from `graphics.dat` `0x22e/0x22f` (`Word7042/7162/7222/7246`, `Byte5752/5758/5696`, `struct5688`, `Item6414`, `MonsterDescriptor`) and object list traversal (`doc/CSBwin-src/Code51a4.cpp:2618+`).
- ✅ Monster palette special-colors now applied per level: `specialColors[13][7]` + `ITEM12.uByte11` drive `ModifyPalettes` for colors 9/10, updating `Palette552` and `Byte6628/Byte6612` (`doc/CSBwin-src/Code390e.cpp:323-343`, `doc/CSBwin-src/CSBCode.cpp:2895-2910`).
- ✅ Timer-driven missile orientation and Item16/SINGLE_MONSTER_STATUS plumbing added (falls back safely when save-game state is absent).
- ✅ Minimal save-game loader added for Item16/timer tables (non-extended saves) (`src/data/SaveGameLoader.ts`).
- ✅ Deterministic `GraphicRandom()` implemented for teleporter/cloud randomness (`doc/CSBwin-src/CSBCode.cpp:574`). (Clouds have since moved to the viewport stream — `DEBT.md` C6.)
- ⚠️ Remaining fidelity gaps: extended-feature save games (sequenced/extended timers + DSA blocks), full monster attack/alternate-graphics state, and exact missile mirror/flip edge cases.

Next steps (Phase 5 follow-up):
1. ✅ Integrated `loadSaveGameState`/`applySaveGameState` into runtime load flow so Item16/timers drive rendering (`src/main.ts`, `src/engine/Game.ts`).
   Description: load/save runtime Item16/timers and apply them before rendering so missile/monster states reflect saved timer data.
2. ✅ Extended save-game loader handles extended-feature saves (sequenced/extended timers + DSA blocks + DSA level index) (`src/data/SaveGameLoader.ts`).
3. ✅ Tightened missile mirror/flip edge cases to use CSBWin parity test (`src/renderer/bytecode/BytecodeInterpreter.ts`).
4. ✅ Ported `TAG00a4a2` + `RandomWallDecoration` (CSBCode.cpp:5779+ / 5696+) and `SummarizeStoneRoom` actuator wallGraphicOrdinal handling (Codea59a.cpp:44-176).
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

1. **Actuator data parity**. Mirror DB3 bitfields and helpers (actuatorType, action, onceOnly, normallyClosed, localActionOnly, targetX/Y/pos, delay, value, DSA selector/state/parameters) per `doc/CSBwin-src/CSB.h:930-1078`.
2. **Timer core**. Implement a CSBWin-style timer queue with `TIMER` layout (time, level, function, uByte5-9) and ordering rules, including `CreateTimer()` semantics from `doc/CSBwin-src/Mouse.cpp:177-207`.
3. **Actuator trigger evaluation**. Port `PressurePadOrAlcove()` logic from `doc/CSBwin-src/Code11f52.cpp:3695-3925`:
   - Floor pads vs wall switches
   - Party/monster/object/direction checks
   - `CONSTPRESSURE` behavior and “normally closed” logic
4. **QueueSwitchAction semantics**. Implement `QueueSwitchAction()` (`doc/CSBwin-src/Code11f52.cpp:3601-3671`) including:
   - `localActionOnly` → `PerformLocalAction()` (`doc/CSBwin-src/Mouse.cpp:223-261`)
   - Room-type → timer function mapping via `Byte1596` (graphic `0x232`) and `WarnIllegalTimer()`.
5. **Timer function handlers**. Port core room-type handlers from `doc/CSBwin-src/Timer.cpp`:
   - `TT_OPENROOM`, `TT_STONEROOM`, `TT_FALSEWALL`, `TT_TELEPORTER`, `TT_PIT`, `TT_DOOR`
   - DB2 show/hide text logic, cell-flag bit changes, and DSA/portrait hooks where present.
6. **Special actuator types**. Implement DB3 actuatorType behavior from `doc/CSBwin-src/CSB.h:930-1048` and `doc/CSBwin-src/Timer.cpp`:
   - Counters (type 6/48), monster generators (type 6 in open rooms), locks (types 3/4/11)
   - Missile launchers (types 7-10, 14-15)
   - `onceOnly` disable semantics.
7. **DSA runtime**. Add DSA execution engine (stack, variables, operations, filters) and DSA timer/message handling (`doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/Timer.cpp:ProcessDSATimer*`).
8. **Integration points**. Wire actuator triggers into movement/object placement (`PlaceOrRemoveObjectInRoom` path in `doc/CSBwin-src/Code11f52.cpp`) and ensure timers tick via the game loop.
9. **Extended features**. Support extended timers and big actuators using `ExtendedFeaturesBlock` flags (`doc/CSBwin-src/Chaos.cpp:2150-2172`) and DSALevelIndex when present.
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
1. **Big actuators + word8**. Add `word8` to `ActuatorRecord` and loader handling for `BigActuators` saves; mirror `MakeBigActuators()` + `DB3::MakeBig()` conversion and use `word8` for `ParameterA/B` high bits (`doc/CSBwin-src/SaveGame.cpp:2499-2527`, `doc/CSBwin-src/data.cpp:1329-1358`).
2. **TouchWall parity**. Expand wall actuator handling for types 13 (torch holder), 16 (swap), and 127 (add character) plus cursor filter hooks and DeleteDBEntry semantics for key removal (`doc/CSBwin-src/Mouse.cpp:291-606`).
3. **Object move triggers**. Implement `PlaceOrRemoveObjectInRoom`-style actuator checks for moved objects/monsters (not just party stepping), including DB2 text print on reveal and proper `movedObjectDBNum`/`movedObjectNameIndex` logic (`doc/CSBwin-src/Code11f52.cpp:3917-3985`).
4. **TT_OPENROOM gating**. Match `TT_DESSAGE`/`TT_ParameterMessage` behavior so DB2 show/hide only occurs for normal timers, and text prints when a hidden DB2 becomes visible with party on the tile (`doc/CSBwin-src/Timer.cpp:1688-1763`).
5. **TT_DOOR parity**. Mirror `ProcessTT_DOOR` requeue behavior (TT_1 transitions and door-state guards) instead of direct door-state writes (`doc/CSBwin-src/Timer.cpp:1556-1588`).
6. **Missile launcher logic**. Implement `TriggerMissileLauncher()` semantics for types 7–10/14/15, including object removal from room, spell construction, and missile launch positions/range (`doc/CSBwin-src/Timer.cpp:1883-2008`).
7. **Generator/teleporter side effects**. Add missing sound queues and `WiggleEverything()` fall forcing for pit/teleporter toggles (`doc/CSBwin-src/Timer.cpp:1772-1824`, `doc/CSBwin-src/Timer.cpp:2410+`, `doc/CSBwin-src/Timer.cpp:2548+`).
8. **DSA opcode coverage**. Audit `DSA.cpp` opcode tables vs `src/engine/DsaSystem.ts` and implement remaining `&` subcodes plus any missing stack ops; document coverage after each batch (`doc/CSBwin-src/DSA.cpp`).
9. **DSA filter wiring**. Add calls to `ProcessDSAFilter` for party move, missile encounters, action-name resolution, and character filters, with correct timer/location parameters (`doc/CSBwin-src/Code11f52.cpp:963-1075`, `doc/CSBwin-src/Character.cpp:4576-4590`, `doc/CSBwin-src/CSBCode.cpp:7879-7927`, `doc/CSBwin-src/CSBCode.cpp:8736-8810`).

### Phase 8.5 — Teleporter cell actions parity (Complete)
Goal: match CSBWin teleporter behavior for movement, visibility, sounds, and timer toggles.

1. **Teleporter record parity**. Honor DB1 bitfields exactly: destination X/Y/level, rotation, facingMode (absolute vs relative), scope (objects/monsters/party/anything), and audible buzz (`doc/CSBwin-src/CSB.h:858-882`).
2. **MoveObject teleporter loop**. Mirror CSBWin’s 1000-iteration teleporter chain with active-bit gating and scope checks, including the “pretend teleporter” one-shot path used by DSA TeleportParty (`doc/CSBwin-src/Code11f52.cpp:2934-3047`, `doc/CSBwin-src/DSA.cpp:4584-4610`).
3. **Party/monster/missile rotation parity**. Use `facingMode` to apply absolute or relative rotation for party, monsters, and missiles; apply the CSBWin `TeleportMonster` group-position logic and `TeleportMissile` direction/pos adjustment (`doc/CSBwin-src/Code11f52.cpp:2343-2445`).
4. **Sound + visibility gates**. Play `soundTELEPORT` only when `audible` is set (party channel 0, monster channel 1), and draw teleporters only when both visible and active bits are set in the cell flag (`doc/CSBwin-src/Code11f52.cpp:2997-3021`, `doc/CSBwin-src/Codea59a.cpp:354-357`, `doc/CSBwin-src/CSBTypes.h:208-210`).
5. **TT_TELEPORTER timers**. Toggle the cell active bit, run DSA activation, and call `WiggleEverything()` so occupants get reprocessed after activation (`doc/CSBwin-src/Timer.cpp:2390-2449`).
6. **Monster movement constraint**. Block monster movement onto an active teleporter when the destination level disallows the monster, matching CSBWin’s pre-move check (`doc/CSBwin-src/Monster.cpp:728-744`).

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
    - Refs: `doc/CSBwin-src/Mouse.cpp:674+` (`ThrowByCharacter`), `doc/CSBwin-src/Attack.cpp:652+` (`DetermineThrowingDistance`), `doc/CSBwin-src/CSB.h:3794+`.
12. ⏳ **Door pass-through + magic damage parity**.
    - Implement DoorTOC pass-through rules and ObjDesc checks for missiles.
    - Port magic damage/poison formulas and Black Flame fireball healing.
    - Refs: `doc/CSBwin-src/Code11f52.cpp:1905+` (door pass-through in `ProcessMissileEncounter`), `doc/CSBwin-src/CSBCode.cpp:4221+` (`DoorTOC` lookup), `doc/CSBwin-src/Code11f52.cpp:1523+` (magic damage formulas), `doc/CSBwin-src/Code11f52.cpp:2011+` (Black Flame fireball heal).
13. ⏳ **Cloud timers/damage parity**.
    - Current state: `createCloud()`/`createCloudRecord()` create the DB13 record and add it
      to the cell, but **no timer is ever scheduled**. Clouds therefore render forever and
      deal no damage. This is a visible bug, not just a missing feature.
    - Implement cloud timers, per-tick damage, and size/decay rules from CSBWin.
    - Refs: `doc/CSBwin-src/Timer.cpp:479+` (cloud timer handling), `doc/CSBwin-src/Code11f52.cpp:1411+` (`CreateCloud` setup + timer linkage).
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
   `src/renderer/csbwin/ScrollingText.ts`). Port from `doc/CSBwin-src/CSBCode.cpp:1432-1610`:
   - `m_futureLines` queue of text pieces (`row`, `col`, `color`, `printLinesCount`).
   - `clockTick()`: place pieces, set `textTimeout[row] = time + 70` (or `+700` when the
     party sleeps), apply the monotonic clamp against the row above.
   - `removeTimedOutText()`: clear the row rect, reset timeout to -1, defer while scrolling.
   - `createNewTextRow()` / `scrollUp()` row management.
   - `resetTime()` for save/load rebasing.
2. **Port the tokenizer** `PrintLines` (`doc/CSBwin-src/CSBCode.cpp:1691`): word wrap at 53
   columns, 2-column indent on continuation, single-space handling, LF → new row (guarded by
   `column != 0 || row != 0`).
3. **Two-stage queue**. `quePrintLines(color, text)` enqueues; the game loop drains one entry
   per iteration into `printLines()` (mirrors `doc/CSBwin-src/CSBCode.cpp:726`).
4. **Convert every caller to fragments.** Emit `printLinefeed()` then append fragments —
   do *not* pre-join with `\n`. Start with `SpellErrorMsg`
   (`doc/CSBwin-src/Magic.cpp:1007`) and the level-up message in `ActuatorSystem`.
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
  `doc/CSBwin-src/Data.h:1681`). Quick-load currently calls `discardText()` instead, so
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
   *(maximum, current, minimum)* byte-triples (`doc/CSBwin-src/CSB.h:2468-2494`,
   `:2624`), not seven numbers. `src/engine/attributes.ts` ports it, including
   CSBWin's byte-wrap and its "above 240 means negative" read
   (`doc/CSBwin-src/data.cpp:1698-1744`), `AddCharacter`'s initial values
   (minimum 30, 10 for Luck, cap 224 — `doc/CSBwin-src/Character.cpp:641-660`) and
   `AdjustCurrentAttribute` (`doc/CSBwin-src/Character.cpp:3917-3951`).
   `tools/checks/attributes.ts` asserts all of it against the real mirrors.

   This was a prerequisite for nearly everything else in the phase — reincarnation
   penalties, the four attribute potions, the red box around the eye, the stats-panel
   colours — and it **fixed a live bug**: `levelUp` raised what was effectively
   *current* where CSBWin raises *maximum* (`doc/CSBwin-src/Magic.cpp:101-151`), so a
   level gain silently healed the attribute instead of opening a gap. It also closed
   the ⚠️ in `isCharacterLucky`, which had no min/max to clamp against, and replaced
   the `attrMax = attrValues.slice()` placeholder in the stats panel, where the
   red/green colour logic had been comparing a value with itself.

   The quick-save format went to v3; older quick-saves are refused, not upgraded.

1. ✅ **`AdjustStamina`** (`doc/CSBwin-src/Code11f52.cpp:4451`) —
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

   `tools/checks/champion-state.ts` covers all three (36 checks) and caught a real defect
   while doing it: `schedulePoison` called `addTimer` after
   `createTimerWithUByte5`, which queues the entry itself, so two copies fired in the
   same pass and poison ran at double rate.

#### Steps

1. ✅ **Death.** Ported in Phase 12: `killCharacter` drops the possessions, creates the
   `value = 2` bones record at the champion's own cell position, and registers the
   bones↔champion mapping through `Game.registerChampionBones()`.
   ⏳ Still missing: the **character-death filter** DSA (`ESL_CHARDEATHFILTER`,
   actuator type 47, `doc/CSBwin-src/Character.cpp:2540-2594`) that runs before
   anything else.
2. ✅ **Item naming.** `getObjectDisplayName` prefixes the champion's name to the bones
   (`src/renderer/ui/Objects.ts:203`), matching
   `doc/CSBwin-src/Character.cpp:3563-3597`. Only actually reachable since the
   `misc_Boulder` mix-up under step 3 was fixed: the objects it tests for were never
   being created.
   ⚠️ It resolves the fingerprint against the *live party* only; CSBWin's
   `CHARDESC::CopyCharacter` also searches the wings (`:5264`), which we do not have.
3. ✅ **Resurrection at the Vi altar.** The `TT_VI_ALTAR` three-state timer is ported
   (`src/engine/TimerSystem.ts`), and the four gaps this step carried are closed:
   - state 2 now calls `CreateCloud(RNffe4)` over the bones
     (`doc/CSBwin-src/Timer.cpp:2730`), so the resurrection is visible;
   - `reviveChampion` became `bringCharacterToLife` and does the whole of
     `doc/CSBwin-src/Character.cpp:805` — the free-`charPosition` search when theirs is
     taken, and `facing = partyFacing`;
   - `findViAltarChampionIndex`, which guessed, is deleted. State 1's second arm reads
     `chIndex = DB10A2->value()` (`Timer.cpp:2789`) — for bones with no expool record
     the `value` field **is** the champion index, which `src/core/constants.ts` already
     said and nothing acted on;
   - the same two arms are now in the drop handler that *schedules* the timer
     (`Mouse.cpp:895-961`). `maybeScheduleViAltar` had only ever tested
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

   `tools/checks/vi-altar.ts` drives both arms, the refusal of a living champion and the
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
   `AddCharacter` (`doc/CSBwin-src/Character.cpp:457`) and
   `Game.resurrectReincarnateCancel` ports `_ResurrectReincarnateCancel`
   (`doc/CSBwin-src/CSBCode.cpp:6674`); the actuator hook is wired inside `Game` now, so
   the tools reach it too. Done:
   - `potentialChampionIndex` — the "almost but not quite added" state. It gates the
     mouth (`Character.cpp:4078`) and, through the click dispatcher
     (`Mouse.cpp:1717-1789`), the portrait boxes, the inventory buttons, the magic panel
     and the attack panel. That is the only thing making the menu modal — CSBWin has no
     mode flag for it.
   - The Resurrect/Reincarnate/Cancel menu: `drawResurrectMenu` (`TAG0189a8`) blits
     graphic 40 and sets `displayResurrectChestOrScroll = 5`, which is what
     `Mouse.ts`'s `tag01a6ea` (`CSBCode.cpp:8605`) switches on to turn a click on button
     id 81 into a `buttons18372` hit. The chest arm of the same function moved with it.
   - **Reincarnate**: all 20 skills wiped, the hero's own
     `reincarnateAttributePenalty`/`reincarnateStatPenalty` charged (`DM_rules` is false
     by default, `data.cpp:252`, so they do apply), then 12 random attribute points —
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
   `statNumbers` is now `DecodeCharacterValue` (`'A'`..`'P'` only, `Character.cpp:415`)
   where it used to accept `'A'`..`'Z'` and build nonsense hex, the MAXHP/MAXSTAMINA/
   MAXMANA clamps are applied, and `reincarnateAttributePenalty`/`reincarnateStatPenalty`
   are parsed off the end of the skill letters. All 24 shipped heroes still parse and
   take the 2/8 fallbacks.

   `tools/checks/hall-of-champions.ts` drives the whole flow through `handleWallClick` at
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

   `tools/checks/reincarnate-entry.ts` (40 checks) drives the state machine. The load-
   bearing one is reading **every key centre of the grid out in order** and requiring
   the unbroken alphabet: the grid arithmetic has three traps — dead pixels between the
   keys, a carriage-return key that answers to two codes (86 and 97), and the shift by
   one that closes the gap it leaves — and getting the third wrong leaves a keyboard
   that still works but types the wrong letter from `W` on. Verified in the browser end
   to end: menu → Reincarnate → type → OK → "ZED REINCARNATED", the box and magic panel
   renamed, the mirror spent.
   - `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`CSBCode.cpp:6599-6671`) is
     not ported. It only fires when the actuator carries a `DisableMessage`, a CSB
     extension the shipped DM dungeon never uses; the `actuatorType(0)` half is done.
   - `pcA3->talents` (`Character.cpp:689`) is parsed by CSBWin and dropped here —
     `Champion` has no field for it.
   - The `legalHero` fallback (`Character.cpp:476`) is not ported. CSBWin clamps a hero
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
5. 🔄 **Drinking potions.** `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4037-4514`)
   is ported as its two halves: `src/renderer/ui/Feeding.ts` derives a
   `FEEDPARAMETERS` block from the object on the cursor, and
   `src/engine/Feeding.ts` applies it, in CSBWin's order, through the `applyFeeding`
   UI hook. All ten acting potion types work, the Ya potion arms its `TT_72`
   expiry timer (newly ported), and a lethal `hitpointAdjust` goes through
   `KillCharacter`. `tools/checks/feeding.ts` drives it over the **real potion records
   in `dungeon.dat`** (47 checks).

   `PotionType` in `src/core/constants.ts` was a guessed enum with eight invented
   members and the wrong values; it is now transcribed from
   `doc/CSBwin-src/Objects.h:14-37`, and the two files that had each written their own
   local constant use it.

   ⏳ **The Feeding Filter DSA is not ported** (`:4305-4361`). The insertion point is
   marked in `handleMouthPress`; no dungeon we load defines `ESL_FEEDINGFILTER`, and
   the parameter marshalling is its own job.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping, and CSBWin's incremental
   `CHARDESC.load` update — `characterLoad` re-sums instead, as it already did.
6. ✅ **Pit fall damage + stamina drain**, for party and monsters
   (`doc/CSBwin-src/Code11f52.cpp:3051-3141`). The pit branch of
   `TimerSystem.resolveCellEffects` now damages what falls through it:
   `DamageAllCharacters(20, 48, 2)` plus sound 6 for a free fall, a per-champion
   `AdjustStamina(25*load/MaxLoad + 1)` when `supressPitDamage` is set, and
   `DamageMonsterGroup(rec, oldX, oldY, 20, …, noItem16)` for a monster group — at the
   cell it fell *from*, because nothing is relinked until the resolver returns.
   `climbDownIntoPit` sets the flag through `withSupressedPitDamage`, and the fall
   clears it, so only the first drop of a chain is free.
   `tools/checks/pit-fall.ts` drops a party down a real pit in the shipped dungeon
   (12 checks).

   This turned up **a second real bug in the Phase 12 damage chain**: `damageCharacter`
   was missing CSBWin's `P4 == 2` branch, which halves the *armour* before the
   `130 - armour` scaling (`doc/CSBwin-src/Character.cpp:2785`). Every fixture in the
   tools is unarmoured, where `0 >> 1` is still 0, so nothing had shown it. It affects
   pit falls and both cloud damage paths.
7. ✅ **The eye and mouth boxes are drawn.** `drawMouthAndEyeBoxes`
   (`src/renderer/ui/Inventory.ts`) ports both blits of
   `doc/CSBwin-src/Character.cpp:1368-1397`: graphic **34** in place of **33** for the
   mouth when `food < 0`, `water < 0` or poisoned, and for the eye when any of
   attributes **1..6** has Current < Maximum. Luck is index 0 and CSBWin's loop starts
   at 1, so it can never mark the eye. Both go into `d.Word1398` / `d.Word1406`, which
   were already extracted, with transparent colour 12 so the icon shows through.

   The "red square on level gain" is answered and is **not level-specific**: a level
   raises the maxima (`Magic.cpp:101-151`) and leaves Current behind, and a drained
   champion shows the identical box.

   ⚠️ **The golden frames cannot see this**, and said so: all five were byte-identical
   after the change, because graphic 33 is the same pixels as the background beneath it
   and the frames only ever capture a fed, undamaged party.
   `tools/checks/status-boxes.ts` (28 checks) covers it instead — both rectangles out of
   `graphics.dat`, both graphics measured and proved to *differ*, and every arm of both
   predicates. Verified red in the browser too, at a champion made starving, poisoned
   and Strength-drained at once.

   One transcription trap worth keeping: `BLT2Viewport(…, 16, 12)` is a **16-byte
   source stride** (32 pixels) and transparent colour 12 — not a 16x12 image. The boxes
   are 18x18 on screen, and 18 pixels padded up to whole bitplane groups is what makes
   the stride 32. Passing the visible width as the stride would skew every row.
8. ✅ **The rest of `KillCharacter`'s tail** (`doc/CSBwin-src/Character.cpp:2675-2699`)
   — done as prerequisite 2. The cursor and the magic tab both move to the first living
   champion, `gameIsLost` is set when there is none, and `CurePoison` runs on the
   corpse.
   ⏳ Not modelled: the `charFlags` redraw bookkeeping (`CHARFLAG_*`), which this port
   has no equivalent for — the renderer redraws from state every frame.
9. ✅ **`handChar` is read from the save block.** The GAMEBLOCK2 offset was never
   unknown — CSBWin's struct comments give the whole 128-byte layout
   (`doc/CSBwin-src/SaveGame.cpp:108-134`): `handChar` at 20, `MagicCaster` at 22.
   `parseBlock2` reads both, `saveSaveGameState` writes both, and
   `applySaveGameState` takes an optional party and assigns them the way `LoadGame`
   does (`:1760-1761`) — **directly**, not through `SetHandOwner`/`SelectMagicCaster`,
   which validate and rewrite facing. The layout is now written up in
   `doc/CSBWIN_SAVEGAME_REFERENCE.md`.

   Establishing the offset turned up **the reason a real DM save could not have been
   read anyway**: the whole block codec was little-endian. CSBWin never says the file
   is big-endian in words, it says it in `LE16`s — `Unscramble`'s hash arithmetic
   (`doc/CSBwin-src/CSBCode.cpp:9162`), `ReadUnscrambleBlock`'s (`:9188`) and every
   `BO()` in `swapBlock2` (`SaveGame.cpp:463`) — and `LE16` is a byte swap on the
   little-endian build CSBWin ships as. Reader and writer agreed with each other, so
   every checksum matched and the round trip was perfect, in a format no other program
   could read. Blocks 1 and 2, `ITEM16`, the characters and the timers are now
   big-endian; the CSB "Extended Features" header stays little-endian, because
   `SwapExtendedFeaturesBlock` is a no-op unless `_bigEndian` (`SaveGame.cpp:276`). The
   quick-save format went to v4 — old quick-saves are refused, not upgraded.

   `tools/checks/savegame-blocks.ts` (22 checks) is the first test the binary half has
   ever had; `checks/savegame.ts` only ever covered the runtime JSON. A round trip cannot
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
     authoritative table is `graphic232.byte1596` (CSBWin `Data.h:1418`) and that the literal
     is only a pre-wiring fallback.
   - `Game.recordSpellCast()` was dead code carrying a `skillNumber = 3` placeholder; the
     live `castMagic` path already uses the spell record's `byte5`, as CSBWin does
     (`Magic.cpp:1398`). Deleted.
   - Stale TODOs in `DrawViewport.ts` ("implement complete viewport buffer system", "draw
     champion portraits", "handle see-through walls") described work that has since landed;
     replaced with what actually happens and where.
   - Still marked, not fixed: `computeThrowSkillGain` is missing CSBWin's
     `+ weaponDesc->uByte3 / 4` term (`Mouse.cpp:725-737`) because `weaponDesc` is not
     plumbed into the engine; `tag008c98Index` is an unverified behavioural approximation of
     `TAG008c98`.
   - **`PLAN.md` was wrong** about the throw skill: `AdjustSkills(chIdx, 10, …)` is literally
     what CSBWin does (`Mouse.cpp:738`), so there is no table to replace. Only the
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
(`Magic.cpp:1316` increments it, `TT_73` decrements it). `render()` now feeds it per frame,
as CSBWin's `SeeThroughWalls` opcode expects (`Viewport.cpp:2645`). Still unported: CSBWin
also recolours a near door while the effect is active (`CSBCode.cpp:4236-4239`).

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
     (`CSB.h:2319`) with named `word2`/`word4`/`word14`/`word16`/`word18`/`word20` bit
     accessors, plus CSBWin's zero-`movementTicks06` clamp (`CSBCode.cpp:10287`).
   - `Item16Record` went from 3 fields to the whole 16-byte `ITEM16` (`CSB.h:2253`) —
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

   Verified with `tools/checks/monster-tables.ts` (new) — the attack names read `BLOCK`,
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
     each of the four call sites, as CSBWin orders it (`CSBCode.cpp:628-645`).
     Restoring a save re-derives the pool (`SaveGame.cpp:1338-1342`).
   - ✅ **Timer types 29-41 routed** out of the dispatcher ahead of the switch, as
     CSBWin does (`CSBCode.cpp:6481`).
   - ✅ **`QueueSound` ported** (`src/engine/SoundQueue.ts`) — the engine can now name
     a sound by ordinal instead of raw SND id. ⚠️ Two gaps: `deltaTime > 1` should
     defer the sound as a `TT_20` timer (`CSBCode.cpp:1861`) but plays it at once,
     and `SoundFilter`'s DSA hand-off (`Sound.cpp:675`) is not ported.
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
     with the per-tick countdown (`CSBCode.cpp:694`).
   - ✅ **`ProcessTimers29to41`'s decision body** — the TT_29/30/31 reaction
     branches, the A-family and B-family timer paths, and the whole movement chain:
     `Try_Directions_D5_To_D4`, `Try_Preferred_Direction_Then_Others`, `Try_To_Move`,
     `D4D0Finish`, `TryUByte67`, `Process_Invincible`,
     `Process_Invincible_And_Finish` and `Standard_Finish`.

   **Monsters now move, hunt and flee.** Verified with `tools/checks/watch-monsters.ts`
   (new): on level 2 with the party at (6,14), most of the 22 groups move over 600
   ticks and none ends up inside a wall; the two groups adjacent to the party both enter
   fear state 6 — the break-formation-and-attack state — and close to distance 1,
   while distant groups stay in state 0 and wander; and the nearest group's path
   `(6,13) → (7,13) → (7,14)` shows the pre-melee position shuffle. Six new entries
   in `doc/PROVEN_FACTS.md`, including the fear-state table.

   - ✅ **`CheckMonsterVersusMissiles`** (`Monster.cpp:4475`) — a monster shuffling to
     another corner of its cell now walks onto any missile already sitting there.

   ⚠️ **One deferral:** `CreateMovementTimer`'s overflow guard is not ported — CSBWin
   counts the groups already waiting at a square and, past 31, deletes the monster
   unless it is `Unique()` or carries something (`Code11f52.cpp:2509-2545`).

   Verified with `tools/checks/monster-move.ts` (new): an Ant Man moved from (1,16) to
   (2,16) leaves the old cell, appears in the new one, and its AI timer follows it
   rather than staying behind, while its `ITEM16` records (2,16) and remembers
   (1,16); a move onto an occupied square yields exactly one abeyance timer carrying
   that monster; and the abeyance timer correctly reschedules while blocked, then
   places the group once the destination clears.

   Verified with `tools/checks/monster-activation.ts` (new): on level 3 the real
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
   bailing out if anyone died (`doc/CSBwin-src/Monster.cpp:2806-2836`). It also needs
   the monster form of `MoveObject` for the off-party-level random walk (`:2912`). So
   the remaining work is *not* "step 3 then step 4" — it is:

   1. ✅ `MoveObject` for monsters — **done**, see step 2 above.
   2. ✅ `DamageMonster` — **done**, see step 4 below.
   3. ✅ `InitialChecks` — **done**, with the timer-helper chain.
   4. ✅ `ProcessTimers29to41`'s decision body and the `Try_*` chain — **done**.
   5. ✅ `MonsterAttacks` + `MonsterDamagesCharacter` + champion death/bones — **done**.
   6. ✅ Creature generators — **done**, see step 5.
   7. ✅ The champion melee pipeline from `Attack.cpp`, with the real attack panel —
      **done**, see step 7.

   Verified with `tools/checks/monster-perception.ts` (new): on level 2 with the party
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
     `AdjustTimerPriority` (`Code11f52.cpp:1229`): the function code is part of the
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
     (`Character.cpp:2421`) is in, so a shield too heavy for its bearer protects less.
     The full suit in `tools/checks/watch-monster-attacks.ts` moved from 18% to 20%.
   - **`Quickness` uses load**: a champion carrying 504 against a 500 max load averages
     13.2, an empty-handed one 26.5 (`tools/checks/throwing.ts`).

   Verified with `tools/checks/watch-monster-attacks.ts` (new): a four-champion party stood
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

   Verified with `tools/checks/monster-damage.ts` (new), four cases on the real
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
     `LaunchObject` (`Magic.cpp:452`), `EnableCharacterAction` (`Timer.cpp:2638`)
     with the bow's auto-reload and the thrown weapon's hand refill (`TAG0115ee`,
     `TAG011594`, `TAG0153c2`), `RemoveCharacterPossession`, `TT_24` and
     `CreateFluxcage` (`Code11f52.cpp:1550`), `MagicShield`'s return value, and
     `ThrowByCharacter` with the filter's range/damage/decay overrides.

   **Four real bugs fell out**, all recorded in `doc/PROVEN_FACTS.md`:
   - **`CT_FLUXCAGE` is 50, not 7.** `MonsterPerception` was comparing against
     `CT_POISON`, so an invincible monster was stopped by a poison cloud and walked
     straight through a Fluxcage — the mechanism the Lord Chaos fusion depends on.
     The constants now live in `src/engine/cloudTypes.ts`.
   - **The party's turn never rotated the champions.** CSBWin adds the turn delta to
     every champion's `charPosition` *and* `facing` (`Code11f52.cpp:4123`); neither
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
   `checks/watch-monster-attacks.ts` and `checks/clouds.ts` were unseeded and are now
   reproducible.

   ⚠️ **`checks/clouds.ts`'s half of that never took effect** and was only found when
   `tools/` was brought inside the type gate (Phase 15 step 1): its
   `game.setRandomSeed(0x12345678)` sat *after* a `return new Game(...)`, so it was
   dead code and every run drew a fresh `Math.random()` seed. Fixed; the tool now
   produces byte-identical output across runs.

   ⚠️ **Deferrals, all deliberate:**
   - **Lord Chaos's endgame** — `_Fusion` (`Attack.cpp:133`) and `_FusionSequence`
     (`:2222`). `atk_FUSE` runs its filter and does nothing else. It cannot be
     exercised until Lord Chaos works, so porting it now would land untested.
   - **`ActionNameFilter`** (`ESL_ACTIONNAMEFILTER`, `CSBCode.cpp:8785`) — the DSA that
     can rename an attack option. Option names come straight from `AttackNames`.
   - **`d.SupressPitDamage`** is not modelled, because the party's own pit-fall damage
     is not ported at all. `atk_CLIMBDOWN` moves the party down the pit through the
     normal `resolveCellEffects` chain and nothing is hurt — which is currently also
     true of falling in by accident.
   - **`_FlashAttackDamage`'s `VBLDelay(15)`** stops the whole game for a quarter
     second. The flash is a timed overlay of the same duration instead; the game keeps
     running underneath, as it already does for the feeding animation.
   - **`FluxCage`'s duplicated neighbour test** (`:1636-1640`) tests `(LCX, LCY-1)`
     twice and never looks south. Kept as written — it is what the real game does.
   - **`atk_SHOOT` overwrites the damage it computes** with the launcher's weapon class
     (`:1934-1935`). Plainly a bug in the original; kept.

   Verified with `tools/checks/player-attacks.ts` (new), seven cases on the real dungeon:
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
*are* ported, since they are reachable today. Validation is `tools/checks/player-attacks.ts`,
`tools/checks/watch-monster-attacks.ts` and `tools/check-frames.sh`, plus the dev-only AI trace
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

   - `checks/clouds.ts`'s dead `setRandomSeed` (see Phase 12 step 7 above);
   - `checks/watch-monster-attacks.ts`'s clothing fixtures never gained the
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
`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`; evidence: `tools/checks/intro.ts` (103 checks) and
golden frames `07-entrance` / `08-credits`.

1. ✅ **The title animation** — `_DisplayChaosStrikesBack` (`CSBCode.cpp:9308`). CSBWin's
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
   `doc/CSBwin-src/CSBCode.cpp:10961`, and `tools/checks/image-codec.ts` checks it against
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
`CSBCode.cpp:9327`, `_TAG01f928`'s never-reset 65535-VBL counter, and CSBWin's fallback where
"Resume" on an empty slot silently starts a new game (an unbounded list has no empty slots).

One genuine divergence, and it is a *narrowing* of one: CSBWin mutates `d.Word68` / `d.Word76`
in place while the doors slide and never restores them. This port walks local copies. The
doors open once per run, so the two are equivalent.

Open items from this phase are in `DEBT.md` → tier H (the intro's wall-clock time and `?intro=0`).

### Resolved debt (moved out of `PLAN.md`)

Entries that were carried as debt and are now closed. Any sub-item still open is listed in
`DEBT.md`; this is the surrounding context, not the status.

- ✅ **The level-3 monster timer stall — no longer reproduces.** Re-checked after
  Phase 12 closed: `npx tsx tools/checks/watch-monsters.ts 3 10 25 200` runs the documented
  repro and the `50000 cap` warning never fires; 5 of 13 groups move and the Muncher
  at (11,29) walks its whole path to (9,25). The next-time computation the entry
  suspected (`Increment_Time_By_W52_Plus_Random` / `EnsureI60NonZero`) was ⏳ when the
  cloud work hit this, and was ported in Phase 12 step 2. Kept here as a record of the
  diagnosis; `tools/checks/clouds.ts` still uses level 2 and need not change.

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
  `tools/checks/clouds.ts` deliberately kills its test monster on level **2** to avoid it.

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
  `setChampionPossession` and `DsaSystem` already do. `tools/checks/throwing.ts` section 7
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
  `d.Pointer16770` (`doc/CSBwin-src/CSBCode.cpp:380-394`) — one of the rare tables that is
  genuinely hardcoded in CSBWin rather than extracted from `graphics.dat`. Two smaller
  faults went with it: the six master ranks start with `` ` `` and `a`..`e`, which are rune
  glyphs in font `0x22d`, so they need `drawTextLineIndexRaw` rather than the upper-casing
  `drawTextLineIndex`; and `getRoleMastery` dropped CSBWin's `0x8000`
  (`doc/CSBwin-src/Character.cpp:4610`), so a potion or spell could have moved the printed
  rank. Written up in `doc/PROVEN_FACTS.md`; `tools/checks/mastery-panel.ts` renders the real
  panel and byte-compares the lines, since no golden frame covers this panel.

  ⏳ **Other empty placeholder tables may be hiding the same way.** This one produced no
  warning and no marker — worth a Phase 15 sweep for arrays and tables that are
  initialised empty and read through a `continue`-on-falsy guard.

- ✅ *(playtest)* **A wall decoration one cell ahead and to the left is no longer cropped
  on the wrong side.** Position 7 (the F2 front-left wall) scales to the width of the F2
  *centre* rectangle and is then drawn into a narrower slot flush against the left border,
  so it must show the bitmap's **right** end — `srcOffsetX = finalBitmapWidth -
  (rect.x2 - rect.x1)` (`doc/CSBwin-src/CSBCode.cpp:3612`). The port computed no
  `srcOffsetX` at all, so it drew the left end instead: cropped on the wrong side, with
  the transparent margin that belonged off-screen showing as a gap from the border.
  Its mirror-image case, position 9, was accidentally right because there the offset
  really is 0. Found by playtest, standing one back and one right of a Hall of Champions
  mirror. Written up in `doc/CSBWIN_DECORATIONS_REFERENCE.md`.

  ⏳ **One deliberate non-port** in the same block: CSBWin's third arm,
  `srcOffsetX = 15 - (finalBitmapWidth & 15)` for the mirrored far-right sidewalls
  (positions 1 and 6, `:3597`), compensates for `MakeMirror` reversing a byte-aligned
  buffer. `getMirroredBitmap` reverses the exact bitmap, so applying it would shift a
  correctly aligned image. Left out on purpose, with the reasoning in the code.

  ⏳ **No golden frame covers an edge decoration**, which is why this survived so long.
  `tools/checks/hall-of-champions.ts` now pins the geometry that makes position 7 special
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
  are that size. Verified by `tools/checks/door-crush.ts`, which shows level 2's door
  stepping `1 → 0 → 1` over an Ant Man and the party losing 71 HP under it.

- ✅ *(playtest)* **Monsters block the party.** `MoveParty`'s monster arm is ported into
  `MovementSystem.handleMovement` — the `d.NumCharacter != 0` gate, the unfiltered
  `FindFirstMonster` (an immaterial monster blocks too), the silence, and
  `ProcessTimers29to41(x, y, TT_M1, 0)` so the group gets a turn out of being bumped
  into. Before this the party walked straight through every monster, which made every
  combat encounter escapable and every combat playtest measure the wrong game.
  Ref: `doc/CSBwin-src/CSBCode.cpp:8373-8391`, written up in
  `doc/CSBWIN_MOVEMENT_REFERENCE.md`. Verified by `tools/checks/party-collision.ts`.

  ⏳ **Three deferrals from the same block**, all pre-existing gaps rather than new:
  - The **wall-bump damage**: CSBWin answers a terrain-blocked move with
    `DamageCharacter(…, 1, 24, 2)` on up to two champions and only then queues sound 18
    (`:8375-8386`). We queue the sound unconditionally and nobody is hurt.
  - **`DiscardAllInput()` / `d.clockTick = 0`** on any inhibited move (`:8398-8402`).
    Not ported because `DiscardAllInput` drains CSBWin's raw keyboard and mouse queues
    (`:7591`), which is not obviously our 3-deep `movementQueue` — that mirrors
    `CSBUI.cpp`'s key queue. Establishing the mapping needs `CSBUI.cpp` read properly;
    guessing it would change how queued moves behave after every bump.
  - The **vertical-move guard** (`:8287-8291`), which refuses a Move Up / Move Down into
    a monster's cell outright. `MovementAction` has no up/down member, so there is no
    entry point to attach it to yet.

- ✅ *(Phase 9 step 11)* **`ThrowByCharacter` is ported.**
  `estimateThrowRange/Damage/Decay` are gone; range, damage and decay come from
  `DetermineThrowingDistance` and skill-10 mastery, in CSBWin's order — the throw raises
  the skill *before* the mastery that sets its range is read. The sound, the stamina cost
  (`TAG016382`) and the action disable came with it; they were missing entirely.
  Ref: `doc/CSBwin-src/Mouse.cpp:673-758`, `doc/CSBwin-src/Character.cpp:2272`.
- ✅ *(Phase 9 step 13)* **Clouds are alive.** `CreateCloud` now schedules the `TT_25`
  timer it always needed, and `ProcessTT_25` is ported in full: the death puff shrinks by
  40 a tick and is gone in 3-6, poison lingers ~85 ticks and hurts whoever stands in it,
  and a fireball bursts a door and vanishes. `CreateCloud`'s own blast damage came with
  it, along with `DamageMonsterGroup`, `DeterminePoisonDamage`, `DamageAllCharacters` and
  `HitDoor`, none of which existed. Verified by `tools/checks/clouds.ts`.
  Ref: `doc/CSBwin-src/Timer.cpp:436`, `doc/CSBwin-src/Code11f52.cpp:1411`.

  ⚠️ `HitDoor`'s `delay` argument is not ported — only the zero case is reachable, since
  the delayed form is `Attack.cpp`'s melee (`TT_BASH_DOOR`), which does not exist yet.
- 🚫 **Every death now goes through `KillCharacter`.** Two paths used to zero `health`
  and set `alive = false` by hand — the missile-hits-party stand-in and a duplicate
  `Game.adjustStamina` — so a champion killed by a missile or by exhaustion left no
  bones and no possessions, and a party wiped by either did not lose the game. Both are
  routed through `MonsterAttack.damageCharacter` now, `DetermineMagicDamage` is ported,
  and `tools/checks/champion-death.ts` checks all three paths produce the same six
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
  `:770`). The TODOs the entry pointed at no longer exist.

  <details><summary>original entry</summary>

- ⚠️ *(Phase 8)* Missile launch, monster creation and `WiggleEverything` still need concrete
  engine hooks — see the TODOs in `src/engine/TimerSystem.ts`.

  </details>

- ✅ **Resolved: attributes raised by a level gain stayed red forever.** `LevelUp`
  raises only an attribute's Maximum (`doc/CSBwin-src/Magic.cpp:101-151`); Current is
  drawn back up one point every 256 ticks (64 asleep) by `TenSecondUpdate`
  (`doc/CSBwin-src/Code17818.cpp:384-414`). Our `processTenSecondUpdate` had only the
  mana and `tempAdjust` parts, and ran every 40 ticks instead of CSBWin's
  `(d.Time & (sleeping ? 15 : 63)) == 0` (`doc/CSBwin-src/CSBCode.cpp:696-698`). It
  is now fully ported: footprint aging, food/water consumption paid in stamina, HP
  regeneration (with the Ekkhard Cross bonus), attribute recovery and the facing
  reset. Food and water therefore now actually go down. Evidence:
  `tools/checks/ten-second-update.ts`. The `d.Word11750` countdown is not ported: it
  is a cursor-redraw counter set only by `CSBCode.cpp:969-975`, which has no
  counterpart here, so the branch is dead.

- ✅ **Resolved: dropping an object onto an active teleporter did not teleport it.**
  `DropObject` (`doc/CSBwin-src/Mouse.cpp:883`) always calls `MoveObject(objD4, -1, 0,
  x, y, NULL, NULL)`, the same teleporter/pit-resolution loop a walking party or
  monster goes through — `Game.dropObjectFromCursor` skipped straight to
  `DungeonState.addObjectToCell` on the raw drop target instead, so a "place the item
  on the plate" puzzle placed the item and nothing else happened.
  `TimerSystem.resolveDroppedObjectPosition` is the new public wrapper around the
  existing `resolveCellEffects` (already used by `wiggleObject`/the actuator path;
  nothing about the teleporter logic itself was wrong), and `dropObjectFromCursor`
  now lands the object wherever that resolves to.
  Evidence: `tools/checks/teleporter-drop.ts` finds a real active, item-scoped
  teleporter in `dungeon.dat`, drops a floor item onto it, and checks the item ends
  up at the destination rather than the drop cell — it fails on the pre-fix code.

- ✅ **Resolved: a thrown object landing on an active teleporter or a pressure plate
  did nothing.** `ProcessObjectFromMissile`'s no-monster arm
  (`doc/CSBwin-src/Timer.cpp:151-159`) is `MoveObject(objD6.pos(missile.pos()), -2, 0,
  mapX, mapY, NULL, NULL)` — the same call `DropObject` makes, which places the
  landed object through `PlaceOrRemoveObjectInRoom`
  (`doc/CSBwin-src/Code11f52.cpp:3473-3481`), the function that fires a pressure
  plate under whatever just arrived. `TimerSystem.dropMissileObject` did neither: it
  called `DungeonState.addObjectToCell` on the raw landing cell with no teleporter
  resolution and — this is the one that actually bites, since a missile's own
  in-flight movement already resolves any teleporter it flies through
  (`moveMissileToCell` → `resolveCellEffects`) — no actuator trigger at all, so a
  puzzle solved by throwing an item onto a plate you cannot stand on (or cannot walk
  to, with a pit in the way) never fired. Now calls the same
  `resolveDroppedObjectPosition` the cursor-drop fix uses, then
  `ActuatorSystem.triggerObjectMove` at the landing cell.
  Evidence: `tools/checks/missile-drop.ts` throws a floor item at a real teleporter and
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
  Evidence: `tools/checks/missile-drop.ts` scenario 3 throws a floor item at a real
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
  `doc/CSBwin-src/Code11f52.cpp:2136-2156`) and `playCloudSound` (`CreateCloud`,
  `Code11f52.cpp:1467-1482`) instead called `playSound` with a hand-picked
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
  Evidence: `tools/checks/missile-drop.ts` scenario 4 throws a weapon and a misc item
  at a real closed door and checks the ordinal `queueSound` receives (0 and 4);
  `tools/checks/clouds.ts` throws a big and a small fireball and checks the same (5
  and 20). Both fail on the pre-fix code.

- ✅ **Resolved: the teleporter/energy shimmer never animated, for two independent
  reasons.**
  1. `GraphicRandom` (`doc/CSBwin-src/CSBCode.cpp:574`) is a C function-static, so
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
  (`doc/CSBwin-src/CSBCode.cpp:648`) — and a tick is 15 VBL at normal speed, i.e. 4
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
  Evidence: `tools/checks/graphic-random.ts` drives the LCG against an exact BigInt
  oracle from five seeds, then checks the specific failure mode directly — 64 draws
  of `% 32` from the class's own starting state must not land on one value. Fails
  on the pre-fix code (all draws land on 0); the `Math.imul` version spreads across
  26 of the 32 possible values.

- ✅ **Added: the "lightning door" energy shimmer was never ported at all** — not a
  bug in existing code, a missing feature. `DrawDoor`'s bit-10 branch of
  `d.DoorTOC[doorType]` (`doc/CSBwin-src/CSBCode.cpp:4221-4231`) redraws with a
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
  (`doc/CSBwin-src/Viewport.cpp:6713-6714`), so drawing a door can never perturb the
  sequence monster AI and combat depend on.
  Evidence: `tools/checks/door-lightning.ts` confirms the shipped dungeon actually
  sets the bit, then drives `opStdDrawDoor` directly across 40 redraws of the same
  closed door and checks the drawn bitmap doesn't sit at a single, frozen pattern.
  Fails on the pre-fix code (always 1 distinct pattern); passes with 13 of 40 draws
  distinct.

  **Left open** (since answered — `DEBT.md` C6, `d9877ef`: clouds take two viewport
  `STRandomBool()`s, missiles are not random at all): whether the cloud- and missile-sprite mirror/flip randomization
  elsewhere in `BytecodeInterpreter` (`this.graphicRandom(2)` for `mirror`/`flip` at
  the cloud-drawing site) is even drawing from the right generator. `GraphicRandom`
  has exactly two call sites in all of CSBWin, both inside `DrawTeleporter` — nothing
  in cloud or missile drawing calls it, so that code's choice of `graphicRandom`
  over a `viewportRandom`-style `STRandomBool()` (or over reading a monster's own
  precomputed mirror bit, set once by game logic rather than re-rolled every frame —
  `NextMonsterUpdateTime`, `doc/CSBwin-src/CSBCode.cpp:5942-6006`, is a real example
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
  carries its cursor”. Evidence: `tools/checks/save-roundtrip.ts`.</sub>

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
  `doc/CSBwin-src/Character.cpp:1343`), so it shows a **blank** title — what the player
  asked for. The reader is not corrected for it; `decodeCharField` now stops at the first
  NUL for the same reason, where it used to skip zero bytes and show `HE DEVIL`.

  A second path to the same byte exists and is a real off-by-one —
  `EditCharacterName`'s insert branch (`doc/CSBwin-src/Chaos.cpp:6539-6540`) shifts from
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
  builds its own). `MonsterSystemHooks.trace` **stays** — `tools/checks/monster-ai.ts`
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


#### `DEBT.md` tier A — Housekeeping (paid 2026-09-23)

- ✅ **A1 — Documentation pointers to things that no longer exist.** Fixed in the commit
  that created `DEBT.md`: `CLAUDE.md` sent project memory to
  `~/.claude/projects/-home-thomas-tmp-dmweb/memory/`, the directory from before the
  repository moved to `~/dev/DMweb` (now `-home-thomas-dev-DMweb`); `PLAN.md` said "see the
  TODOs in `src/engine/DsaSystem.ts`" and "…in `src/engine/TimerSystem.ts`", and neither
  file has any. The DSA entry was rewritten as `DEBT.md` G1; the `TimerSystem` one was
  already paid.

- ✅ **A2 — Stale comments, a dead parameter, console noise.** Paid in `1c0f132`. The
  save-version comment now explains versions 6 (the timer table by index, `timerQueue`,
  `timerSequence`) and 7 (a timer's object in the byte pair `ConvertTimers` names); the
  two `random` doc comments are one; `MISSILE_WOUND_MASK` sits below the imports;
  `BytecodeInterpreter` is no longer a "Prototype" and its bitmaps are `IndexedBitmap[]`;
  the `Game initialized at position…` log is gone. `castSpellFromUi` lost its third
  argument — CSBWin's cast button calls `CastMagic(0)` with no mana cost
  (`doc/CSBwin-src/Magic.cpp:567`), since each rune's mana was spent as it was added — and
  with it the UI's now-unused `computeIncantationManaCost`. The stale `HitDoor` comment in
  `TimerSystem` now points at `DEBT.md` C1 rather than claiming melee does not exist; C1
  itself removes it. The same session made `tools/check-frames.sh` run on Node 20, which
  hides the global `WebSocket` behind `--experimental-websocket` (`f36cbbc`).

  <details><summary>original entry</summary>


Each of these misleads a reader today:

- `src/engine/Game.ts:130` — `RUNTIME_SAVE_VERSION = 7`, but the doc comment above it
  explains versions 2–5 only. Version 6 came with `a149db7` ("Now loading CSBWin save
  files") and 7 with `c6f038c` ("Save file to disk"); `git show` both and write the two
  missing paragraphs.
- `src/engine/Game.ts:178-188` — the `random` field carries two stacked doc comments, the
  first orphaned. Merge them.
- `src/engine/Game.ts:53` — `MISSILE_WOUND_MASK` is declared between two import blocks.
- `src/renderer/bytecode/BytecodeInterpreter.ts:2` calls itself a "Prototype", and
  `:40-41` type `wallBitmaps` / `doorBitmaps` as `any[]` with "mock in tests" — there are
  no tests. Type them `IndexedBitmap[]`.
- `src/engine/TimerSystem.ts:2505-2507` says the delayed `HitDoor` belongs to a melee
  attack that "does not exist yet". It does; this one is fixed with C1.
- `src/engine/Game.ts:2710-2713` — `castSpellFromUi(chIdx, incantation, totalManaCost)`
  throws its third argument away with `void totalManaCost;` to satisfy
  `noUnusedParameters`. Drop the parameter (and the caller's argument), unless CSBWin's
  caller uses it — check `Magic.cpp`.
- `Game`'s constructor `console.log`s `Game initialized at position…`, which every
  `tools/` run prints. Remove it or send it to the debug log.

Done when none of the above remains and `npm test` passes.

  </details>

#### `DEBT.md` tier B — Duplicate implementations (paid 2026-09-23)

##### B1 ✅ One `DescIndex`, one `GetBasicObjectType`, one `NameIndex`

**Paid in `779ae8b`.** `src/engine/objectIndex.ts` holds `DescIndex`, `GetBasicObjectType`
and `NameIndex`, transcribed from `data.cpp:569-701` and `CSBCode.cpp:1255`, plus
`DescIndexOfRecord` — the same switch over a record in hand, for `AddCharacter`'s preset
path, which has no `DungeonState`. Every copy listed below is gone or is a one-line wrapper
over the module (`ui/Objects.ts`' `resolveObjectNameIndex`, `getBaseObjectNameIndex`,
`descIndexForObject`; `Game`, `DsaSystem`, `ActuatorSystem` each keep a private one-liner
that supplies their tables). A seventh copy the entry missed, in `ActuatorSystem`
(`getBasicObjectType` / `getDescIndex` / `getBasicObjectTypeFromValue`), went too, as did
the one in `tools/checks/level-items.ts`. The UI's `getBaseObjectNameIndex` and
`getAttackClass` take an RN only; `Feeding`'s explicit object-type path keeps the type as
its name index, which is what the old guess returned. Every `DetermineMastery` hook
(`CharacterStats`, `AttackSystem`, `Game`'s three, the UI's attack menu) and
`CharacterStats`' `MaxLoad` now get `NameIndex`, as CSBWin does (`Code17818.cpp:76,98`,
`Code11f52.cpp:4341`). `Game` receives `d.Byte640` through `ActuatorTables.byte640`.

Behaviour: unchanged on the stock dungeon — every DM chest is type 0, and none of the
mastery or load objects (Firestaff, talismans, Elven Boots) is modifiable, so `NameIndex`
and `GetBasicObjectType` agree on them. The failure value is now `OBJNI_NOT_AN_OBJECT`
everywhere. Evidence: `tools/checks/object-index.ts` (new, in `npm test`) walks all 1950
records of `dungeon.dat` and forces the compass, torch, scroll, waterskin and charged-weapon
states; the golden frames are unchanged.

Found on the way: `ActuatorSystem.doesPartyHave` is not `DoesPartyHave` — C11.

<details><summary>original entry</summary>


**What.** CSBWin has exactly one of each: `RN::DescIndex` (`doc/CSBwin-src/data.cpp:569`),
`GetBasicObjectType` (`doc/CSBwin-src/CSBCode.cpp:1255`), and `RN::NameIndex`
(`doc/CSBwin-src/data.cpp:613`) — the *modified* name index, which accounts for the
compass's facing, a lit torch's charge, an open scroll and so on. The port has:

| CSBWin | Our copies |
| --- | --- |
| `RN::DescIndex` | `Game.getObjectDescIndex` (`src/engine/Game.ts:2391`), `DsaSystem.getObjectDescIndex` (`src/engine/DsaSystem.ts:2773`), `BytecodeInterpreter.descIndexForObject` (`src/renderer/bytecode/BytecodeInterpreter.ts:2111`), `descIndexForObject` (`src/renderer/ui/Objects.ts:111`), `getObjDescIndex` (`src/engine/AddCharacter.ts:301`) |
| `GetBasicObjectType` | `Game.getBaseObjectNameIndex` (`src/engine/Game.ts:2383`), `DsaSystem.getBaseObjectNameIndex` (`src/engine/DsaSystem.ts:2368`), `getBaseObjectNameIndex` (`src/renderer/ui/Objects.ts:86`) |
| `RN::NameIndex` | `resolveObjectNameIndex` (`src/renderer/ui/Objects.ts:20`) — the UI only; the engine has none |

**They have drifted.**

- *Chests.* CSBWin returns `BITS1_2(word4) + objDI_Chest` (`data.cpp:583`). `DsaSystem`
  and `AddCharacter` return a constant `1`.
- *Masks.* The renderer and UI copies mask the type with `0xff`, the engine copies with
  `0x7f`. Neither mask does anything: the loader already masks with `0x7f`
  (`src/data/DungeonLoader.ts:664-783`).
- *Failure value.* `GetBasicObjectType` returns `objNI_NotAnObject`. `Game`'s copy returns
  -1, `DsaSystem`'s returns the object ID itself, the UI's returns its argument.
- *One parameter, two meanings.* The UI's `getBaseObjectNameIndex` accepts either an RN or
  a bare object-type number and uses `isLikelyObjectRecord` to guess which
  (`ui/Objects.ts:90-92`).
- *No engine `NameIndex`.* That is why `CharacterStats`' `nameIndex` hook is fed the
  *base* index — the second half of the ⚠️ that used to sit in `PLAN.md` under
  `src/engine/CharacterStats.ts`. Only `determineMastery`'s Firestaff A/B bonus can see
  the difference (a modifiable object, name index 0–31); the Elven Boots check in
  `MaxLoad` (index 119) cannot.

None of this shows in play today — DM chests are type 0 and the masks are no-ops — which
is exactly how it will bite later.

**Fix.** One module (suggestion: `src/engine/objectIndex.ts`, beside the `OBJNI_*`
constants in `src/core/objectNameIndex.ts`) exporting `DescIndex`, `GetBasicObjectType`
and `NameIndex`, named as CSBWin names them and transcribed from the C++, not from any of
our copies. `resolveObjectNameIndex` is probably most of `NameIndex` already: check it line
by line against `data.cpp:613+` and move it. Give the UI's object-type path its own
function — `getDescIndexForObjectType` (`ui/Objects.ts:141`) already exists. Point every
caller at the new functions, including `CharacterStats`' hook at `NameIndex`, which closes
that ⚠️.

**Evidence.** Extend `tools/checks/object-name-index.ts` (or add a sibling) to walk every
object record in `dungeon.dat` and assert the three functions over it — a chest, a lit and
an unlit torch, a compass at each facing, an open scroll. Then `npm test -- --frames`,
since the renderer and UI copies move.

</details>

##### B2 ✅ Small helpers defined in several files

**Paid in `6f8b47c`..`4934252`, one commit per helper.** Every name below has one
definition; each commit ran `npm test`, and the ones touching `src/renderer` or `src/ui`
ran the golden frames too. No behaviour changed — where copies differed, the difference is
shown unreachable below.

| Helper | Now | Notes |
| --- | --- | --- |
| `normalizeWord6` ×5, private `sw` ×3 | `sw()` in `src/core/intCast.ts` | CSBWin's own name for the `(i16)` cast (`CSBTypes.h:141`); `i16` is already a type name in `core/types.ts`. `div` (×2) and `applyLimits` (×2, `CSBCode.cpp:1183`) moved beside it. `ApplyLimits` lets `min` win when `min > max`, `CharacterStats`' copy let `max` win; every caller passes constants with `min < max`. `Feeding.limit` stays: it is `LIMIT` (`CSB.h:3168`), a different macro. |
| `findFirstMonsterAt` ×6 | `DungeonState.findFirstMonster` | A sixth copy was in `ui/ViewportPicking.ts`. `TimerSystem`'s returned `null`; its callers now test `OBJECT_ID_EOF`. Stopping on `OBJECT_ID_NULL` or not is the same walk: category 15 is never a creature and `getDBRecordLink(NULL)` is `EOF`. `AttackSystem` keeps a one-line wrapper for CSBWin's two-argument overload, on the party's level. |
| `ordinalOfMonsterAtPosition` ×2 (+1 inline) | `monsterPosition.ts` | The body was already single; the three adapters that unpacked a `CreatureRecord` for it are now its record-level form, `(dungeon, monsterDesc, monster, pos)`. **C2 can use it.** |
| `isMonsterAllowedOnLevel` ×3 | `DungeonState.monsterAllowedOnLevel` | The third was `MonsterPerception.monsterAllowedOnLevel`. |
| `isValidLocation` ×2 | `DungeonState.isValidLocation(l, x, y)` | `LOCATIONREL::IsValid`, `DSA.cpp:311`. |
| `getRoomTimerFunction` ×2 | `roomTimerFunction()` in `roomTimers.ts` | `d.Byte1596`. Its hardcoded fallback is an F1 candidate. |
| `deleteMonsterMovementTimers` ×2 | `TimerQueue.deleteMonsterMovementTimers` | Takes the trace sink; `MonsterDamage`'s path now writes CSBWin's trace line too (trace output only). |
| `quickness` ×2 | `CharacterStats.quickness` | `MonsterAttack.quickness` passes `d.PartySleeping` through. Its load-free fallback is gone; it could not run, since `Game` injects `CharacterStats` right after building `MonsterAttack`. |
| `championAt` ×3 | `Party.getPartyChampion` | It already existed, exported for this. |
| `triggerObjectMove` ×3 | `ActuatorSystem.triggerObjectMove` | That one is CSBWin's `PlaceOrRemoveObjectInRoom` (`Code11f52.cpp:3917`), now said so. `DsaSystem`'s wrapper went; it passed facing `0`, harmless because the facing is read only for actuator type 3, which requires the party itself (`OBJECT_ID_NULL`) as the mover. `Game.triggerObjectMove` stays: it is the UI drop (the walk, then level load and timers), documented as such. |
| `setObjectPosition` ×2, `withPosition` | `withObjectPosition()` in `core/types.ts` | `RN::pos(p)`, `CSBTypes.h:342`. `ActuatorSystem`'s copy passed `NULL`/`EOF` through; both its callers are in branches where the hand is full. |
| `isLikelyObjectRecord` ×2 | `engine/objectIndex.ts` | Takes a `DungeonState`. |
| `readU16LE/BE`, `readU32LE/BE`, `readI16BE`, `readI8`, … | `src/core/bytes.ts` | Eight copies across five `src` files (`SaveGameLoader`, `CSBGraphicsLoader`, `CsbwinExtendedFeatures`, `CsbwinCharacters`, `ObjectTables`) and three tools. |

Left alone, deliberately:

- `ActuatorSystem.triggerObjectMove` takes `facing` as a parameter where CSBWin reads
  `d.partyFacing` (`Code11f52.cpp:3811`). Every party-move caller passes the facing the
  party has at that point; reading it inside would be tidier but needs each caller's
  ordering checked against CSBWin's — not a dedupe.
- `LOCATIONREL` has three shapes — B3.

<details><summary>original entry</summary>

Found by name. **Compare the bodies before merging**; where copies differ, find which one
matches CSBWin before choosing.

- `normalizeWord6` — a 16-bit sign extension, five identical copies:
  `src/engine/TimerQueue.ts:398`, `src/engine/TimerSystem.ts:3321`,
  `src/engine/Game.ts:2999`, `src/renderer/ui/Objects.ts:188`, and
  `DsaSystem.normalizeWord6` (`src/engine/DsaSystem.ts:2375`). It is misnamed too: it is
  applied to brightness, not only to a timer's `word6`. Make it one `i16()` in
  `src/core/` — CSBWin simply casts `(i16)`.
- `findFirstMonsterAt` — five copies: the public `MonsterSystem.findFirstMonsterAt`
  (`src/engine/MonsterSystem.ts:325`) and private ones in `MonsterDamage.ts:711`,
  `MonsterPerception.ts:632`, `TimerSystem.ts:2715` and `AttackSystem.ts:418`. The
  `TimerSystem` copy differs: it returns `null` rather than `OBJECT_ID_EOF`, and does not
  stop on `OBJECT_ID_NULL`. CSBWin's is `FindFirstMonster` (look it up in
  `doc/CSBWIN_SYMBOL_INDEX.tsv`). It probably belongs on `DungeonState`.
- Same name in two or three files, bodies not yet compared:
  `ordinalOfMonsterAtPosition` (`MonsterAI.ts`, `TimerSystem.ts`),
  `isMonsterAllowedOnLevel` (`MonsterSystem.ts`, `TimerSystem.ts`),
  `isValidLocation` (`DsaSystem.ts`, `TimerSystem.ts`),
  `getRoomTimerFunction` (`ActuatorSystem.ts`, `DsaSystem.ts`),
  `deleteMonsterMovementTimers` (`MonsterSystem.ts`, `MonsterDamage.ts`),
  `quickness` (`CharacterStats.ts`, `MonsterAttack.ts`),
  `championAt` (`MonsterAttack.ts`, `AttackSystem.ts`),
  `triggerObjectMove` (`ActuatorSystem.ts`, `DsaSystem.ts`, `Game.ts`),
  `setObjectPosition` (`ActuatorSystem.ts`, `Game.ts`).
- `isLikelyObjectRecord` — "does this RN index a real record of an object database" —
  in `Game.ts` and `src/renderer/ui/Objects.ts` (`ActuatorSystem`'s `hasRecord` went with
  B1). CSBWin has no such check; it is the port's guard. One copy, next to `DescIndex` in
  `src/engine/objectIndex.ts`, is the natural home.
- `src/data/SaveGameLoader.ts:191-240` has its own `readU16LE/BE` and `readU32LE/BE`
  beside `src/core/BinaryFile.ts`.

The "no object" normalizers are copies too, but they disappear in D2 rather than being
merged here. `ordinalOfMonsterAtPosition` must be single before C2, which needs it.

Done when each name has one definition — or two, with a comment citing CSBWin for why they
differ — and `npm test` passes.

</details>

##### B3 ✅ `LOCATIONREL` has three shapes

**Paid in `5f77cc5`.** `LocationRel { l, x, y, p }` lives in
`src/core/types.ts` with `locationRelToInteger` / `locationRelFromInteger` (CSBWin's two
`Integer()`s); `DungeonState.isValidLocation` takes one, as `IsValid()` does. `DsaLocation`,
`TeleportPartyLocation`, `TimerSystem.LocationRel` and `DsaSystem`'s private
`locationToInt` / `intToLocation` are gone. No behaviour changed: the masks are the old
ones, and `npm test` passed before and after. Found on the way: `TimerSystem.throwMissile`
has no caller — see G1.

<details><summary>original entry</summary>

Found in B2. CSBWin has one `LOCATIONREL` (`doc/CSBwin-src/DSA.cpp:301-318`: `l`, `x`, `y`,
`p`, with `Integer()` and `IsValid()`). The port has `TimerSystem.LocationRel`
(`{ position, posInCell }`), `DsaSystem`'s `DsaLocation` (`{ l, x, y, p }`) and its
`TeleportPartyLocation` (the same four fields again). Pick one, next to
`DungeonState.isValidLocation`, and give it CSBWin's `Integer()` decoding
(`DsaSystem`'s `intToLocation`). Size S.

</details>

#### `DEBT.md` tier D — State representation (paid 2026-09-25)


##### D1 ✅ Hands stored twice *(bundle with D2)*

**Paid in `114dbbe`.** `Champion.shieldHand`, `weaponHand` and `quiver` are gone;
every reader and writer uses `possessions` only, and a tool builds a champion with it.
The unused `PossessionSlot` enum went too: its names for slots 6-12 were a guess, and
CSBWin's own reload order says otherwise (the search starts at slot 12, then 7-9,
`doc/CSBwin-src/Timer.cpp:2656-2672`, `CSBCode.cpp:6322-6329`, where the port's comments
had said "the quiver, then the three pouch slots"). In its place, `POSSESSION_COUNT`,
`SLOT_SHIELD_HAND` and `SLOT_WEAPON_HAND` (`src/engine/gameTypes.ts`), used by the UI's own
code; ported code keeps CSBWin's bare `Possession(1)` numbers, to stay greppable. The one
case where a mirror had disagreed with the array was C27, fixed first. `RuntimeSaveState`
carries `PartyState`, so its shape changed: `RUNTIME_SAVE_VERSION` went to 8. Evidence: a grep
finds no mirror; `npm test -- --frames` passes unchanged, the save round-trips included.

<details><summary>original entry</summary>

`Champion` keeps its hands in both `possessions[0]`, `[1]` and `[8]` and three named
fields, `shieldHand`, `weaponHand` and `quiver` (`src/engine/gameTypes.ts:191-193`), and
every writer has to remember both — `Game.setPossessionDirect` (`src/engine/Game.ts:2700`)
is the pattern. The named fields are typed `any`, so the compiler cannot help. CSBWin has
only `possessions[30]`.

Delete the three fields, read and write the array through named slot constants, and let
`tsc` find every site. Check that the save paths (`SaveGameLoader`, `CsbwinCharacters`,
`RuntimeSaveState`) serialise the array only.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “A thrown or shot object no longer stays in the hand as well”.</sub>

</details>

##### D2 ✅ One "no object" value

**Split** (size L, recorded while paying D1). One commit each, in this order:

| Step | What | Status |
| --- | --- | --- |
| D2a | `possessions` becomes a required 30-entry `ObjectID[]`, `RNnul` its only empty value. `DsaSystem.normalizePossessionValue` / `isEmptyObject` and the array-growing code in the three `setChampionPossession` copies go. The save loaders store `RNnul` as read. | ✅ |
| D2b | `objectInHand` becomes a required `ObjectID`, `RNnul` when empty. `Game.normalizeObjectInHand`, `ActuatorSystem.normalizeObjectInHand` and `ui/Objects.normalizeObjectValue` go. | ✅ |
| D2c | Retire `isLikelyObjectRecord` (`Game.ts`, `ui/Objects.ts`): a plain `!== OBJECT_ID_NULL` where a guard is still needed, nothing where it is not. | ✅ |
| D2d | The possession readers (`getChampionPossession` in `Game`, `CharacterStats.possession`, `ui/Character`, `skills.getPossessionNameIndex`, `MonsterAttack.clothingTypeIn`, and `AttackSystem`'s hook) return `RNnul` like CSBWin's `Possession()` instead of `null`, and `ui/Character.setChampionPossession` takes it. Every caller is converted by hand — `tsc` cannot see a stale `=== null` — so list them first with a grep and convert them all in one commit. Found paying D2a. | ✅ |

**D2a, paid in `865d704`.** `Champion.possessions` is a required `ObjectID[]`, built
by `emptyPossessions()` (`src/engine/gameTypes.ts`), and an empty slot holds `RNnul`
everywhere — the loader stores it as read (an `RNeof` in a file slot still becomes
`RNnul`, as it did before), the writer writes it back unchanged, and no module grows
or re-normalises the array. Every reader that skipped `null` now skips `OBJECT_ID_NULL`;
`tsc` finds only the writers, so each reader was converted by hand, and the element-read
grep in the commit is the audit. `Game.setChampionHand` no longer treats `RNeof` as
empty. The per-module `getChampionPossession` readers still return `ObjectID | null` to
their callers: changing that to CSBWin's `RNnul` return is invisible to `tsc`
(`number === null` compiles, branded or not), so it is a step of its own, D2d.
`DsaSystem.normalizePossessionValue` / `isEmptyObject` survive only for `objectInHand`,
and go with D2b. `RUNTIME_SAVE_VERSION` is 9. Evidence: `npm test -- --frames`, the save
round-trips included.

**D2b, paid in `bbd902d`.** `PartyState.objectInHand` is a required `ObjectID`,
`RNnul` when the cursor is empty, and so is every slot of the chest view
(`UIState.openChestContents`, CSBWin's `d.rnChestContents[8]`, built by
`emptyChestContents()`). The four normalizers are gone: `Game.normalizeObjectInHand`,
`ActuatorSystem.normalizeObjectInHand`, `DsaSystem.normalizePossessionValue` with its
`isEmptyObject`, and `ui/Objects.normalizeObjectValue`. The CSBWin loader maps a file's
`RNempty`, `RNnul` or `RNeof` cursor to `RNnul`. `Game.handleDoorSwitchClick` no longer
treats `RNeof` as an empty hand, and `ActuatorSystem`'s wall-object switch hands
`GetBasicObjectType` the `RNnul` itself, which returns `OBJNI_NOT_AN_OBJECT` as the old
`?? OBJNI_NOT_AN_OBJECT` fallback did (`src/engine/objectIndex.ts`). The viewport's
five picked-object RNs are filled with `RNeof` by `ViewportRenderer`, and
`ViewportPicking` now tests for that directly. `RUNTIME_SAVE_VERSION` is 10. Found on the
way: C29, fixed first. Evidence: `npm test -- --frames`; a grep finds none of the four
normalizers.

**D2c, paid in `f0297c2`.** `isLikelyObjectRecord` is gone, with all fourteen calls.
Thirteen guarded a value already known to be an object — a slot or the cursor, tested
against `RNnul` just before — and simply went. The fourteenth, `drawScrollPanel`'s check
of a Viewing Filter DSA's answer, is CSBWin's own `obj.checkIndirectIndex(...)` then
`dbType() == dbSCROLL` (`doc/CSBwin-src/Character.cpp:3524-3528`) and is now
`getScrollRecord(candidate)`. Three functions existed only for the "an object *type*,
not an object" overload the guard chose between, and had no caller left that passed a
type: `ui/Objects.getObjectWeight`, `getObjectWeightForObjectType` and
`getDescIndexForObjectType`. `canPlaceInSlot` and `computeFeedParameters` take the RN
path only. Evidence: `npm test -- --frames`; a grep finds none of the four names outside
`doc/PLAN_ARCHIVE.md`.

**D2d, paid in `d1b3f8f`.** Every possession reader is CSBWin's `Possession()` and returns
`RNnul` for an empty slot: `Game.getChampionPossession`, `CharacterStats.possession`,
`ui/Character.getChampionPossession`, `AttackSystem`'s `possession` hook, and
`removeCharacterPossession` (`Game` and `AttackSystem`'s hook), which returns `RNnul` as
CSBWin's does. `MonsterAttack.clothingTypeIn` became a `possession()` reader and
`armourStrength` makes `TAG01680a`'s own test, `== RNnul || dbType() != dbCLOTHING`
(`doc/CSBwin-src/Character.cpp:2410-2412`, `:2470-2471`). `skills.getPossessionNameIndex`
hands the `RNnul` to `NameIndex`, which answers `objNI_NotAnObject` as CSBWin's does
(`CSBCode.cpp:1259`). `ui/Character.setChampionPossession`, `updateLightForPossessionChange`
and `setTorchLitState` take an `ObjectID`, and `ui/Objects.isChestRecord` no longer takes
`null`. The audit was the grep of every reader's callers, about forty sites in eleven
modules and four tools, all converted in the one commit. The four tools with a stale
`=== null` failed until converted (72/76), which shows they read the readers.
`RuntimeSaveState` did not change, so `RUNTIME_SAVE_VERSION` stays 10. Five one-line
readers remain, one per module; E1 is where they become one. Evidence: `npm test --
--frames`; a grep of the readers' callers finds no `null` test.

Each is a refactor: `npm test` before and after, `-- --frames` since each touches
`src/renderer/ui/`, and `RUNTIME_SAVE_VERSION` bumped for D2a and D2b (both change
`PartyState`). The port has one `getChampionPossession` per module (`Game`,
`CharacterStats`, `ui/Character`, `DsaSystem`, `skills`); D2a may leave them as one-line
reads, and merging them is B-tier work to record, not to smuggle in.


**What.** An empty possession slot or the cursor can hold `null`, `undefined`,
`OBJECT_ID_NULL` (0xFFFF) or `OBJECT_ID_EOF` (0xFFFE) (`src/core/types.ts:112-113`).
`possessions` is an *optional* `Array<number | null>` and `objectInHand` is
`ObjectID | null` (`src/engine/gameTypes.ts:195`, `:239`). So every module normalises for
itself, with four identical functions:

- `Game.normalizeObjectInHand` (`src/engine/Game.ts:2722`)
- `ActuatorSystem.normalizeObjectInHand` (`src/engine/ActuatorSystem.ts:870`)
- `DsaSystem.normalizePossessionValue` (`src/engine/DsaSystem.ts:2338`), plus
  `isEmptyObject` (`:2412`)
- `normalizeObjectValue` (`src/renderer/ui/Objects.ts:170`)

It also guards with `isLikelyObjectRecord` (`Game.ts:2357`, `ui/Objects.ts:150`), called
about twenty times. That function only checks that a record index is in range — a
defensive guess at whether a number is an object at all.

CSBWin has one empty value, `RNnul`; `RNeof` only ever terminates a chain.

**Fix (recommended).** Make `RNnul` (`OBJECT_ID_NULL`) the only empty value everywhere a
slot or the cursor is stored. CSBWin does that, and the save file already stores it, so the
load/save boundary stops converting. Make `possessions` a required 30-entry `ObjectID[]`.
Delete the normalizers. Wherever `isLikelyObjectRecord` still guards something after B1 has
split the RN/type overload, replace it with a plain `!== OBJECT_ID_NULL` or delete it. If
an `OBJECT_ID_EOF` ever turns up in a slot, that is a bug upstream to find, not a value to
normalise.

The alternative — `null` as the one empty value, converted at the file boundary — is less
churn but departs from CSBWin; "port, don't reinvent" argues for `RNnul`.

**Evidence.** `npm test -- --frames`; `tools/checks/save-roundtrip.ts` and
`tools/checks/live-save-file.ts` prove the boundary. A grep proves the normalizers are gone.
If `RuntimeSaveState`'s shape changes, bump `RUNTIME_SAVE_VERSION`.

##### D3 ✅ Most state fields are optional

**Split** (size L, recorded 2026-09-25 before any code; re-counted then: `Champion` has
23 optional fields, `PartyState` 12). One commit per group, in this order:

| Step | Fields | Initializer, checked against CSBWin | Status |
| --- | --- | --- | --- |
| D3a | `PartyState`: `partyShield`, `fireShield`, `spellShield`, `invisible`, `seeThruWalls`, `magicFootprintsActive`, `indexOfFirstMagicFootprint`, `indexOfLastMagicFootprint`, `numFootprintEnt` — the spell-effect counters (~45 fallbacks) | the `Party` constructor, all 0 (`Data.h:782-798`) | ✅ |
| D3b | `PartyState`: `potentialChampionIndex`, `gameIsLost`, `sleeping` (~24) | the constructor: -1 (`d.PotentialCharacterOrdinal` 0, less one), `false`, `false` | ✅ |
| D3c | `Champion`: `actionDisabledUntil`, `busyTimerIndex`, `attackType`, `attackStatModifier` (~12) | `AddCharacter`: `busyTimer = -1`, `attackType = -1` (`Character.cpp:520-521`), the rest cleared by `ClearMemory(pcA3, 800)` (`:482`) | ✅ |
| D3d | `Champion`: `wounds`, `poisonCount`, `maxRecentDamage`, `damageFromDirection`, `shieldStrength` (~25) | cleared, except `facing3 = d.partyFacing` (`:532`) | ✅ |
| D3e | `Champion`: `charFlags`, `timerIndex`, `talents`, `causeOfDamage`, `monsterCausingDamage`, `load` (~8). `fingerprint` moved to D3g, `incantationCursor` to the fix below | cleared, except `talents = 0` (`:513`), `timerIndex = -1` (`:522`), `charFlags` (`:531`, `:595`) | ✅ |
| D3f | `Champion`: `title`, `facing` (~18) | `AddCharacter`'s text parse, `facing = d.partyFacing` (`:523`) | ✅ |
| D3g | `Champion.fingerprint` (~6). Its absence means "not assigned yet" to `Game.assignChampionFingerprint`, which gives one to a champion that did not come through `AddCharacter` (the tools' and `dev.ts`'s, on `addChampion`, `setPartyState`, a restore, and lazily at death in `registerChampionBones`). A required 0 would stop that. **Decided 2026-09-25:** a champion gets its fingerprint once, when it joins, as `AddCharacter` does (`:514-517`). `Game.addCharacter` already does; `Game.addChampion` (the dev/tool path) computes it unconditionally. The lazy assignments in `setPartyState`, the runtime-save restore and `registerChampionBones` go (a save always carries the field), and so does `registerChampionBones`' `if (!fingerprint) return`, which CSBWin does not have (`Character.cpp:2651`). A tool that puts champions into the party without `addChampion` sets their fingerprints itself: divergences stay in the tools, never the engine. | `AddCharacter`'s `FingerprintExists` loop (`:514-517`); 0 in `addCharacterDefaults` (`ClearMemory`) | ✅ |

The `Champion` defaults live in one function in `src/engine/AddCharacter.ts`, CSBWin's
`ClearMemory` plus `AddCharacter`'s constant stores, which `createChampionFromPreset`
and the tools' champion builders spread. `Party.setState` fills a field an older
runtime save lacks from the same defaults, so `RuntimeSaveState` keeps its JSON shape and
the saves in `static/gamefiles/saves/` keep loading (they were checked: they lack
`sleeping`, the shields, `wounds` and more).

**D3a, paid in `b988d0b`.** The nine counters are required. `initialPartyState` (`src/engine/Party.ts`)
is `PartyState`'s one initializer: the constructor returns it, and `setState` spreads it
under the restored state, so a field an older save lacks takes the same value (the three
shields were missing from every save in `static/gamefiles/saves/`; all three still load and
run). 34 fallbacks went, every one `?? 0`, the initializer's own value, so no hidden
default. `ViewportRenderer`'s `partyState?.seeThruWalls ?? 0` stays: it guards a missing
`partyState`. `RUNTIME_SAVE_VERSION` stays 10. Evidence: `npm test -- --frames`.

**D3b, paid in `50408fe`.** `potentialChampionIndex`, `gameIsLost` and `sleeping` are required, all three
in `initialPartyState` (`sleeping` had been missing from it). The CSBWin loader sets them
too: none is in the file's party blocks, and `LoadGame` clears `d.GameIsLost`
(`doc/CSBwin-src/SaveGame.cpp:2095`). 29 fallbacks and `=== true` tests went; each
matched the initializer. Four `ui.partyState?.… ?? x` stay in `ui/` (`Keyboard`, `Mouse`,
`Attack`), because they guard a missing `partyState`. Evidence: `npm test -- --frames`, and
the three saves in `static/gamefiles/saves/` still load and run.

**D3c, paid in `a5a27db`.** `actionDisabledUntil`, `busyTimerIndex`, `attackType` and
`attackStatModifier` are required. Their initializer is `addCharacterDefaults()`
(`src/engine/AddCharacter.ts`), `ClearMemory` plus `AddCharacter`'s constant stores. It
grows one group at a time. `createChampionFromPreset` spreads it, and so do the 25
champion literals in `tools/` (tsc found each one). `Party.setState` spreads it under each restored
champion, replacing its two hand-written `??`. Ten fallbacks went, each the initializer's
value. `Game.setBusyTimerRefill`'s `champion?.busyTimerIndex ?? -1` stays: it guards a
missing champion. Evidence: `npm test -- --frames`; the three saves still load.

**D3d, paid in `b4332d5`.** `wounds`, `poisonCount`, `maxRecentDamage`, `damageFromDirection` and
`shieldStrength` are required, all cleared in `addCharacterDefaults`. 36 `?? 0` went.
The 37th fallback was `ui/Attack.ts`'s `damageFromDirection ?? champ.facing ?? 0`, a
different default. It was unreachable, because its guard, `maxRecentDamage`, turns non-zero
only at `MonsterAttack.ts:240`, which sets `damageFromDirection` in the same statement group. So it
went too. What it hid is the `facing3` fix below. Evidence: `npm test -- --frames`.

**D3e, paid in `a050ea8`.** `charFlags`, `timerIndex`, `talents`, `causeOfDamage`,
`monsterCausingDamage` and `load` are required, in `addCharacterDefaults`. Eight
fallbacks went, all in the save writer, each the initializer's value. Two of the planned
eight fields came out of the group: `fingerprint` (D3g) and `incantationCursor`, whose
fallback hid a different default. That one is the second fix below. Evidence:
`npm test -- --frames`; the three saves still load.

**D3f, paid in `5297dd6`.** `title` and `facing` are required: `''` and 0 in `addCharacterDefaults`,
`ClearMemory`'s values. `createChampionFromPreset` sets the title, and `Game.addCharacter`
sets the facing to `d.partyFacing`, as `AddCharacter` does (`Character.cpp:523`). Nine
fallbacks went. One hid a different default: `setPartyFacing` rotated
`champion.facing ?? facing`, so a champion without one started from the party's facing.
No engine champion lacks one (`addCharacter`, the CSBWin loader and every runtime save set
it), so only tools' hand-built champions could reach it. None depends on it: `npm test --
--frames` passes unchanged. `ui/Character.ts`'s `champion?.facing ?? facing` stays; it
guards a missing champion. Left as found: `createChampionFromPreset`'s own
`facing: partyPosition & 3`. It is not CSBWin's, but only `dev.ts` and the tools keep it,
because `addCharacter` overwrites it.

**D3g, paid in `fe3ae24`.** `fingerprint` is required, 0 in `addCharacterDefaults`.
`Game.addChampion` computes it unconditionally, as `addCharacter` does, so a champion gets
its fingerprint once, on joining. `assignChampionFingerprint` went with its four lazy
callers (`addChampion`, `setPartyState`, the runtime-save restore,
`registerChampionBones`); `registerChampionBones`' `if (!fingerprint) return` had gone
first, as a fix (below). Five `?? 0` / `?? -1` went. No tool needed to set fingerprints
itself: the ones that put champions in the party without `addChampion` never kill them,
and `checks/vi-altar`'s preset `0x1000 + i` went, since `addChampion` now overwrites it.
`RUNTIME_SAVE_VERSION` stays 10: every runtime save already carries the field (the three in
`static/gamefiles/saves/` load with their fingerprints and run). Evidence: `npm test`.

Found while splitting, and paid as separate fixes:

- ✅ **`facing3`.** `AddCharacter` sets `pcA3->facing3 = d.partyFacing` (`Character.cpp:532`);
  the port left `damageFromDirection` unset, so the save writer wrote 0 and
  `ui/Attack.ts` fell back to `champ.facing`. **Paid** after D3d: `Game.addCharacter` sets
  it with `facing` (`2def79c`). `tools/checks/hall-of-champions.ts` recruits DAROOU, whose mirror the
  party faces west, and failed before the fix (facing3 0, not 3).
- ✅ **`byte33`.** The save writer wrote `incantationCursor ?? incantation.length`, and the
  engine never updates `incantationCursor`. So a champion loaded from a save keeps the
  file's `byte33` while runes are added or cast in the port, and the next save writes it
  back stale. CSBWin's add would then write the next rune at the wrong index. Every CSBWin
  writer of `byte33` keeps it equal to `strlen(incantation) & 3`: the add
  (`CSBCode.cpp:9089-9093`), the backspace (`Magic.cpp:817-820`), the cast (`:954-955`),
  and the two resets with `incantation[0] = 0` (`Character.cpp:2653-2654`,
  `:5318-5319`). So the field is derivable and should go, like D5's `tiles`. **Paid in
  `76e0ee3`:**
  `incantationCursor` is gone, and the writer derives `incantation.length & 3`. The
  fourteen committed saves still pack byte-identical. `tools/checks/character-block.ts`
  types two runes into a loaded champion and failed before the fix (byte33 0, not 2).
- ✅ **A fingerprint of 0.** `registerChampionBones` returned early when a champion's
  fingerprint was 0, so their bones got no expool record and the Altar of Vi read the
  bones' `value` (2) as a champion index instead. CSBWin's `AddChampionBonesRecord` call is
  unconditional (`Character.cpp:2651`, `data.cpp:1639-1646`), and 0 is `AddCharacter`'s
  fingerprint for a champion recruited at level 0, (0, 0). **Paid** before D3g's refactor:
  the guard is gone. `tools/checks/vi-altar.ts` section 1b kills a champion whose
  fingerprint is 0 and failed before the fix (no record, nobody raised).

Not debt, so staying optional:

- `portrait` / `portraitGraphic`: a champion has one or the other (a save's pixels, or a
  graphic-26 cell for one this engine made). Absence is the information.
- `titleField` / `incantationField`: kept only when the file holds bytes past the
  terminator. Absence is the information again.
- `charFlags`' graphic bits (0xff80): `AddCharacter` sets `CHARFLAG_positionChanged`
  (`:531`), a redraw flag, and the port models none of those (see C32's
  `CHARFLAG_statsChanged` note). Only `CHARFLAG_male` is carried.

<details><summary>original entry</summary>

`Champion` has 24 optional fields out of 35, and `PartyState` 13 out of 25
(`src/engine/gameTypes.ts`). That is where `src/engine/` gets its 277 `?? 0` and 62 `?.[`.
CSBWin's `CHARDESC` has no optional fields; the optionality is a relic of porting one field
at a time.

Make them required, initialised in one place per type (`createChampionFromPreset` in
`src/engine/AddCharacter.ts`, `Party`'s constructor, the save loaders), then remove the
`?? 0` fallbacks field by field. Watch for a fallback that hides a *different* default from
the initializer's, and check the initializer against CSBWin. Split across sessions by field
group, and record the split here. If `RuntimeSaveState`'s shape changes, bump
`RUNTIME_SAVE_VERSION`.

</details>

##### D4 ✅ `ObjectID` is not a distinct type

**Measured 2026-09-25**, on a throwaway worktree. With the brand alone
(`ui16 & { readonly [rnBrand]: true }`), `tsc` reported 140 errors in 14 files, 111 of them
in `DsaSystem` and `TimerSystem`, every one a plain `number` flowing into an `ObjectID`
parameter or field. A script that cast every error site until `tsc` was clean needed 146
new `as ObjectID` casts. With three boundary types instead (`decodeObjectID` takes any
number, `DsaSystem.isValidObjectId` a type guard, `TimerEntry.object` an `ObjectID`), 93
errors were left. The errors found no live bug, but they showed where the port holds RNs
in plain numbers (the DSA's words, the timer's object, the missile paths) and one real
confusion: `createFluxcage` passed a *cloud type* where `createCloudRecord` wanted an RN,
correct only because `CT_FLUXCAGE & 0x7f` is itself.

**Decided: brand it.** CSBWin's `RN` is a class (`doc/CSBwin-src/CSBTypes.h:275`); an
integer becomes one only through `RN(RNVAL)` or `ConstructFromInteger`, so a distinct type
with explicit conversions is the faithful shape, not an embellishment. Dropping the casts
would have kept a type that checks nothing.

**Paid in `8606715`.** `ObjectID` is branded (`src/core/types.ts`), and a plain number
becomes one only through `as ObjectID`, at the places CSBWin converts: a file's words
(`DungeonLoader.readRN`, `SaveGameLoader.resolveRN`, `CsbwinObjectIndex.resolve`), the
timer words a restore reads back, a DSA word once `isValidObjectId` has checked it (a type
guard), the `RNVAL` constants in `src/core/spellRn.ts` and `OBJECT_ID_NULL` / `_EOF`.
`encodeObjectID` and `withObjectPosition` return one. Everything else was retyped rather
than cast: the DSA's move sources and destinations, the timer's missile, projectile, cloud
and Vi-altar paths, `TimerEntry.object`, `DescIndex` / `GetBasicObjectType` / `NameIndex` /
`IsAKey` and the UI's `resolveObjectNameIndex` family (whose callers' `| 0` went), and the
hooks that carry an RN. `createCloudRecord` takes the cloud type, and its callers pass
`GetSpellType()` (`projectile & 0x7f`, `Code11f52.cpp:1463`) or `CT_FLUXCAGE`, as CSBWin's
two creators do. Casts went from 101 to 96: 31 that re-cast an `encodeObjectID` result
went, 26 boundary casts came. Two duplicates went with them: `MonsterDamage`'s own
`RN_MONSTER_DEATH`, and the `RN_*` constants seven tools re-declared, which now import
`spellRn`. Found and recorded, not fixed: C35. Evidence: `npm test -- --frames` passes
unchanged. `RuntimeSaveState`'s JSON shape is untouched.

C25 was waiting for D4, but the brand does not settle it: C25 needs an RN *comparison*
that ignores the corner, and a brand cannot forbid `===`. See C25.

<details><summary>original entry</summary>

`type ObjectID = ui16` (`src/core/types.ts:110`) is a plain `number`. So the 82
`as ObjectID` casts check nothing, and a name index or a slot number passes for an object
ID silently. After D2, decide: brand it (`number & { readonly __rn: unique symbol }`),
which would make `tsc` catch RN/type confusion like B1's overload, or drop the casts.
Measure the churn on a branch first.

</details>

##### D5 ✅ Cell flags stored twice (`cellFlags` and `tiles`)

**Paid in `468ebc6`.** `MapData.tiles` and `TileData` are gone; `cellFlags` is the one copy of the byte,
as in CSBWin, and readers unpack it with `getRoomType` / `cellHasObjects`
(`src/core/types.ts`). The six writers that kept `tiles` in step (`DungeonState`'s
has-objects and door writers, `TimerSystem.setDoorState` / `setCellFlag`,
`DsaSystem.updateCellFlag`, `applyDungeonSnapshot`) write the byte only.
`DungeonState.getTile` went, with its five `isWall` / `isDoor` / `isPit` /
`isTeleporter` / `isStairs` helpers, which had no caller; `hasObjects` reads the flag.
`tiles` was never serialised, so `RUNTIME_SAVE_VERSION` stays 10. Three tools that wrote
both copies write one; `checks/savegame`'s "the tiles agree with the flags" check went
with the thing it checked. Evidence: `npm test -- --frames` passes unchanged before and
after; a grep finds no `.tiles` or `TileData`.

<details><summary>original entry</summary>

Found paying C13. `MapData` keeps each cell's flag byte in `cellFlags[x][y]` and again,
unpacked, in `tiles[x][y]` (`TileData`: `cellFlag`, `roomType`, `hasObjects`,
`attributes`, `src/data/dungeonTypes.ts:87`). `getCellFlag` reads the first,
`getTile` the second; `DungeonState.setCellHasObjects` and the door writers keep them in
step, and `tiles` has readers in `DungeonSnapshot`, `TimerSystem`, `DsaSystem` and
`ui/mapPreview`. CSBWin has one byte per cell. A writer that updates one copy leaves
the other stale — C13's type-7 scenario had to write both. Keep `cellFlags`, derive the
rest where it is read.

##### D6 ✅ `GameState.party` is a second copy of `Party.state`

*(Found paying E1b, 2026-09-25.)* `GameState` (`src/engine/gameTypes.ts`) carries
`party: PartyState`, set once in `createGameContext`, while `Party.setState` replaces
`Party.state` with a new object. `Game` keeps the two in step by hand:
`this.state.party = this.party.state` appears ten times in `Game.ts` (after `setState`,
`addChampion`, the Hall of Champions, `setBrightness`, the runtime-save restore…). A path
that replaces the party and misses the resync leaves `game.state.party` naming the old
object — and `applySavePayload` (`src/engine/SaveGamePayload.ts`) writes a loaded save's
blocks *into* `game.state.party`. Not seen to go wrong; it is the D-tier shape of bug
(stored twice, kept in step by hand). Fix: drop `GameState.party` and read
`ctx.party.state`, as every subsystem now does. Re-audit the ten sites first: some may be
resyncing after a `setState` that no longer exists.

**Paid in `27a5aae`.** The re-audit found every site resyncing after nothing: the only
two `Party.setState` callers (`setPartyState`, `applyRuntimeSaveState`) resynced
themselves, so `game.state.party` and `game.party.state` always named the same object and
no path had gone wrong. `GameState.party` is gone, the thirteen `this.state.party = …`
lines with it (`applyFeeding`'s `if (applied)` resync among them), and `applySavePayload`
writes the loaded blocks into `game.party.state`. Behaviour-neutral: every tool's output
byte-identical, frames identical, and the author's three runtime saves load and play 600
ticks to the same state as before the change (`RUNTIME_SAVE_VERSION` unchanged at 10:
`GameState` is not saved as such).

</details>

#### `DEBT.md` tier C — Known divergences, C1–C24 and C26–C32 (paid 2026-09-23 to 2026-09-25)

The tier's open items (C25, C33 and up) are still in `DEBT.md`.

##### C1 ✅ The melee door bash ignores `HitDoor`'s delay

**Paid in `ca34722`.** `TimerSystem.hitDoor` takes CSBWin's `delay` (and the `d.Time` it
counts from); `AttackSystem`'s door arm passes 2. A delayed hit queues `TT_BASH_DOOR`
(= 2, new in `TimerFunction`), and `processBashDoor` — `ProcessTT_BASH_DOOR`,
`Timer.cpp:1492` — shatters the door when it fires. `TimerQueue` gained `SetTimer`'s
`TT_BASH_DOOR` rule: queueing one deletes every `TT_1` / `TT_DOOR` timer on the cell
(`Timer.cpp:1102-1123`). Evidence: `tools/checks/player-attacks.ts` case 8 (fails four checks
before the fix); the fact is in `doc/PROVEN_FACTS.md`.

Found on the way and fixed in `cbba108`: `hitDoor` compared the force with
`DoorCharacteristics[doorType]` instead of the level's `DoorTOC[doorType]`
(`CSBCode.cpp:5845-5848`). Levels 6, 12 and 13 map door type 0 to entries 3 and 2, so a
door there needed 110 force instead of 255 or 230 — invisible in stock DM, which has no
breakable door on those levels. `DungeonState.doorTOC` is now the one copy, shared with
`MonsterPerception`. Evidence: case 8b. Found too, and recorded as C12: the port's other
duplicate-timer rules.

<details><summary>original entry</summary>

`Attack.cpp`'s door-bash arm calls `HitDoor(attackX, attackY, strength, 0 /*not a ZO
spell*/, 2 /*delay*/)` (`doc/CSBwin-src/Attack.cpp:1803-1808`). Our `AttackSystem` calls
`hooks.hitDoor(position, strength, false)` with no delay, and `TimerSystem.hitDoor`
(`src/engine/TimerSystem.ts:2509`) has no `delay` parameter: only the zero-delay case — the
spell's — is ported. When this was recorded, melee did not exist and the delayed form was
unreachable; Phase 12 step 7 made it live. `HitDoor` itself is at
`doc/CSBwin-src/Code11f52.cpp:2298`; the original note names the delayed path
`TT_BASH_DOOR`.

Port the `delay` arm and whatever it queues, and fix the stale comment at
`TimerSystem.ts:2505-2507`. Evidence: extend `tools/checks/player-attacks.ts` to bash a real
door and check its state on the attack tick and after the delay.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “Clouds are alive”.</sub>

</details>

##### C2 ✅ Missile→monster damage skips the magic and poison formulas

**Paid in `4393754`.**
`TimerSystem.processMissileEncounter`'s monster arm is now CSBWin's, line for line
(`Code11f52.cpp:1995-2077`): the victim is `ordinalOfMonsterAtPosition` of the arrival
corner (an empty corner lets the missile fly on unless the group is `drawAsSize4`); a
fireball heals a Black Flame (capped at 1000) and vanishes; the blow is
`sw(((64 * magic) & 0xffff) / defense08) + DeterminePoisonDamage`, and a blow of 0 skips
`DamageMonster` but still spends the missile; survivors get `ProcessTimers29to41(TT_M2)`;
the dagger-absorption arm runs only when nobody died. `Game.applyMissileDamageToMonster`
is gone — a `damageMonster` hook takes its place, passing CSBWin's `noItem16 = false` —
and `d.MonsterDamageResult` is reset at the top of each encounter, as CSBWin does.

Found on the way and fixed in the same commit, because the monster arm's formula depends
on it: the port turned a thrown Ven or Ful potion into its cloud **before** the switch,
while CSBWin keeps `RNprojectile` as the potion until the tail (`:2095-2098`). So a bomb's
first blow — on a monster *and* on a champion — was a fireball's instead of a thrown
object's. The door arm reads the potion too since C9.
Evidence: `tools/checks/missile-monster.ts` (9 of 15 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

The monster arm of `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:2042-2050`)
divides `64 * DetermineMagicDamage(...)` by the monster's `defense08`, adds
`DeterminePoisonDamage`, and picks its victim with `OrdinalOfMonsterAtPosition`.
`Game.applyMissileDamageToMonster` (`src/engine/Game.ts:1248`) passes the missile's raw
damage to `DamageMonster` and hits the first living group member. Everything it needs
exists: `TimerSystem.determineMagicDamage` (`TimerSystem.ts:2621`, so far used by the party
arm only), `MonsterDamage.determinePoisonDamage`, and `ordinalOfMonsterAtPosition` (single
after B2). Visible in play: spells and thrown weapons deal the wrong damage to monsters.

Do this before E3 moves the missile code: C2 is a fix, E3 a move. Evidence: a `tools/`
scenario that fires at a real group and checks the damage against a hand computation of
the formula, and which member took it.

<sub>Recorded in Phase 13. Context: `doc/PLAN_ARCHIVE.md` → "Phase 13 — Champion lifecycle".</sub>

</details>

##### C3 ✅ `NinetySecondUpdate` cadence, and its body unaudited

**Paid in `f507904`.** `Game.processNinetySecondUpdate`
gates on `(tickCount & 511) == 0`. Auditing the body against `CSBCode.cpp:7398-7446` found
one more divergence: CSBWin loops over `d.NumCharacter` less one while
`d.PotentialCharacterOrdinal != 0`, so a Hall of Champions recruit's torch does not burn;
the port burned it. The torch test now uses `NameIndex` as CSBWin does (it used
`GetBasicObjectType`, which agrees for every torch), and hands go 1 then 0.
`SelectPaletteForLightLevel` / `DrawEightHands` need no call: both are derived from live
state every frame. Evidence: `tools/checks/ninety-second-update.ts` (5 of 6 checks fail
before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

CSBWin calls `NinetySecondUpdate` when `(d.Time & 511) == 0`
(`doc/CSBwin-src/CSBCode.cpp:690-693`). `Game.processNinetySecondUpdate`
(`src/engine/Game.ts:1397`) fires on `tickCount % (TICKS_PER_SECOND * 90)` — every 360
ticks instead of every 512, so about 1.4 times too often. Its body (torch burn-down) was
never audited against `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7398`). Port both,
the way `processTenSecondUpdate` was; `tools/checks/ten-second-update.ts` is the model for
the evidence.

</details>

##### C4 ✅ `DamageCharacter` is missing two of CSBWin's three early guards

**Paid in `be5fcb5`.**
`MonsterAttack.damageCharacter` now opens as CSBWin does (`Character.cpp:2717-2722`):
`sw(damage)`, then `chIdx == -1` → 0, the recruit → `chIdx + 1`, a won game → 1 (through a
new `isGameWon` hook), a non-positive blow → 0, and only then the missing-champion and
zero-health checks. The `sw` was a third, unlisted gap: a blow of `0x10005` now hurts for 5.
Evidence: `tools/checks/champion-death.ts` → "DamageCharacter's early guards" (5 checks fail
before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`doc/CSBwin-src/Character.cpp:2717-2719`: `chIdx+1 == d.PotentialCharacterOrdinal`, which
makes a champion still standing in a Hall of Champions mirror unhurtable, and
`d.Word11694` — `Game.gameWon` in this port — a global damage suppressor. Both return early
with a non-zero value, so a caller reading the result sees "damage was dealt".
`MonsterAttack.damageCharacter` (`src/engine/MonsterAttack.ts`) guards only on the index, a
missing champion and zero health. The mirror guard matters now that missiles reach the
party through this function. `PartyState` already carries the potential-character ordinal
(`src/engine/gameTypes.ts:218`).

</details>

##### C5 ✅ Three movement deferrals

All in CSBWin's move handler, `MoveParty` (`doc/CSBwin-src/CSBCode.cpp:8031`). Two were
fixes, one needed nothing; what the re-reading found beyond them is C13.

- ✅ **Wall-bump damage.** Paid in `73f6a86`. `MovementSystem.bumpWall` is `:8350-8378`: `GetCharacterToDamage` on the two
  corners of the crossed side, `DamageCharacter(ch, 1, 24, 2)` on each, and sound 18 only
  if `k != 0`. The map edge is bumped the same way (`GetCellFlags` answers stone there).
  `MovementHooks` became required — only `Game` builds a `MovementSystem`. Evidence:
  `tools/checks/party-collision.ts` case 5 (2 of 15 checks fail before); the fact is in
  `doc/PROVEN_FACTS.md`. Found on the way: the tool built its `Game` without `byte586`,
  and `MonsterAttack.determineAttackOrder` then silently uses `[0, 1, 2, 3]` — an F1
  placeholder.
- ✅ **`DiscardAllInput()` / `d.clockTick = 0`** on any inhibited move (`:8397-8401`).
  Paid in `d9eceae`, after `8159938` split `Game.runFrame` out of the loop so a tool can
  step frames. The mapping,
  read rather than guessed: `DiscardAllInput` drains the key queue and resets the mouse
  queue (`:7591`, `CSBUI.cpp:1395-1412`), and every move the port queues is in
  `movementQueue` (clicks are handled as they arrive), so the port clears that. (Since
  C21 that is `Game`'s one mouse queue, keys and clicks alike.)
  `d.clockTick` is "a tick is due", and the VBL sets it again on every VBL once
  `vblCount >= d.Speed` (`:1076-1087`), so zeroing it holds a due tick for one VBL —
  `Game.clockTickCleared` skips the tick for the rest of the frame. `MovementResult`
  carries CSBWin's `D5W` as `inhibited`. Evidence: `tools/checks/party-collision.ts` case 6
  (4 of 21 checks fail before); the fact is in `doc/PROVEN_FACTS.md`.
- 🚫 **The vertical-move guard** (`:8287-8291`), which refuses a Move Up / Move Down into
  a monster's cell outright. Nothing to port: CSBWin cannot reach it either. Move Up / Down
  (`0x1124` / `0x1125`) come only from `ThreeDMovements` keys (`:8575-8586`) and
  `GravityMove` (`Mouse.cpp:1260`, `:1335-1337`, called only while `gravityMove`, which
  only `if (GravityGame)` sets, `:8166-8170`). Both flags are the 3DMaze extension's,
  initialised `false` (`data.cpp:240-241`) and assigned nowhere in the tree.

<sub>Context: `doc/PLAN_ARCHIVE.md` → “Monsters block the party”.</sub>

##### C6 ✅ Which generator cloud and missile sprites flip with

**Paid in `d9877ef`.** Missiles were already right: CSBWin derives their mirror and flip from
the graphic's `word4`, the timer's direction, the relative position and `(mapX+mapY)&1`
(`Code51a4.cpp:2356-2465`), with no randomness, and `drawMissilesAtPosition` already did
that. Clouds were wrong three ways: they rolled `GraphicRandom` instead of the viewport's
`STRandomBool()`, rolled mirror before flip (CSBWin: flip first, `Code51a4.cpp:258-260`),
and ignored `tag006932`'s placement — the even-height `+1` on `y1` and the left-edge source
column `Larger(LOCAL_30, LOCAL_22 - x - 1)` (`:265-287`). While there: `viewportRandom`
starts at CSBWin's `0x34175432` (`Viewport.cpp:6704`) instead of a host random seed. No
golden frame shows a cloud, so none moved. Evidence: `tools/checks/cloud-draw.ts` (7 of 14
checks fail before); the fact is in `doc/PROVEN_FACTS.md`. The rest of `DrawClouds`' drift
is C14.

<details><summary>original entry</summary>

Lifted from inside the resolved "teleporter shimmer" entry (now in the archive), where it
was left open. `GraphicRandom` has exactly two call sites in all of CSBWin, both inside
`DrawTeleporter`; nothing in cloud or missile drawing calls it. Yet
`BytecodeInterpreter` rolls `this.graphicRandom(2)` for the `mirror` / `flip` of clouds
(`drawClouds`) and possibly missiles (`drawMissilesAtPosition`). What CSBWin does instead
is unverified: a `viewportRandom`-style `STRandomBool()`, or a mirror bit precomputed by
game logic rather than re-rolled every frame (`NextMonsterUpdateTime`,
`doc/CSBwin-src/CSBCode.cpp:5942-6006`, is an example of the latter). Read the cloud and
missile drawing source in `Viewport.cpp` first, then port what it does.

</details>

##### C7 ✅ `CreateMovementTimer`'s overflow guard is not ported

**Paid in `7a90d0c`.**
`MonsterSystem.createMovementTimer` counts the waiting `TT_60` / `TT_61` timers of its kind
on the square and, from 31, deletes the group unless it is `Unique()` or carries something
(`Code11f52.cpp:2508-2547`). `Unique()` goes through `monsterUnique`, which applies
CSBWin's `drawAsSize4Monsters` gate — a constant `false` until G4 models the option.
Evidence: `tools/checks/monster-move.ts` case 4 (3 of 18 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`doc/CSBwin-src/Code11f52.cpp:2509-2545`; the gap is noted in place at
`src/engine/MonsterSystem.ts:636`. Recorded in Phase 12 step 2.

</details>

<sub>Context: `doc/PLAN_ARCHIVE.md` → "Phase 12 — Monsters".</sub>

##### C8 ✅ Phase 8 DSA leftovers

Re-audited 2026-09-23. The first bullet was not DSA at all but the actuator local action;
it is **paid in `600811e`**. The second is paid in two commits; what it uncovered is C15
and C16.

- ✅ **`PerformLocalAction`'s champion.** `SkillIncreaser` (`Mouse.cpp:210-231`) credits
  `d.HandChar`, the cursor's owner; the port matched a living champion's `partyPosition`
  against the actuator's wall position. And `PressurePadOrAlcove` passes `-1`, not the
  alcove's position (`Code11f52.cpp:3910`), which also changes `RotateActuatorList`'s
  filter. Evidence: `tools/checks/local-action.ts` (3 of 6 checks fail before); the fact is
  in `doc/PROVEN_FACTS.md`.
- ✅ **DSA cloud moves.** `DsaSystem.findCellSource` now hands a cloud over: the check
  pass finds its `TT_25` / `TT_24` (lowest slot, index compare) or returns
  `SER_BadCloudTimer` (`MoveObject.cpp:227-245`), and `findCellDestination` retargets
  it — square, level and the placed ID (`:522-529`). **The old note that missiles need
  nothing was wrong:** `FindCellDestination` has a `dbMISSILE` arm (`:574-596`) that
  writes the new square into `timerWord8` and the new level; that is ported too.
  Evidence: `tools/checks/dsa-move.ts` (8 of 13 checks fail before); the fact is in
  `doc/PROVEN_FACTS.md`. What is still not CSBWin's about a DSA cell move is C15.
- ✅ **Deferred deletes.** `&DEL` now condemns through `DsaSystem.deleteObject` onto the
  bank's `objectDeleteList`, and `processTimer6Internal` ends with `consumateDeletes`,
  returning whether the slave went — which the three timer walks already `break` on.
  Before, the walks stopped only by accident: the freed slave's link read `0xFFFF`,
  which decodes as a cloud and was skipped. The deferral itself is not yet observable
  in play, because the port never reuses a freed slot; it will be once slot reuse is
  ported (C16). Evidence: `tools/checks/dsa-delete.ts` (4 of 9 checks fail before); the
  fact is in `doc/PROVEN_FACTS.md`.

The archived shimmer entry notes that no dungeon this project loads defines a DSA, so
neither DSA bullet could show in play; both tools build their own DSA.

<details><summary>original entry</summary>

- `PerformLocalAction()` does not map `HandChar` precisely; it matches on `partyPosition`
  when `mapPos` is specified. Suspect it of the same confusion between cell position and
  champion index that was fixed in `Party.getPartyChampion` and `MagicPanel`.
- DSA object manipulation skips the cloud and missile timer updates, and does not free DB
  records on delete (CSBWin uses a deferred `DeleteDBEntry`).

The archived shimmer entry notes that no dungeon this project loads defines a DSA. If that
holds, neither can show in play today, which is why this sits last among the verified
divergences.

</details>

##### C9 ✅ Door pass-through rules and the magic damage/poison formulas

Re-audited 2026-09-23: the magic damage and poison formulas and Black Flame healing were
C2's; what was left was the door arm, and none of it was there. `TimerSystem.
processMissileEncounter`'s `case RoomType.DOOR` is now CSBWin's line for line
(`Code11f52.cpp:1879-1970`): a Zo spell works a door's button at `d.Time + 1` and is spent
either way (the port let it fly on at an open door, and read the time off the missile
timer); `DoorTOC`'s high-byte bit 1 lets a non-physical spell through, and a thrown object
that out-ranges `STRandom(128)`, fits in a pouch and is not a key; everything else hits
the door with `HitDoor(DetermineMagicDamage + 1 + STRandom % that)`. `RN::IsAKey` is
`objectIndex.IsAKey` now, and `TimerSystem` gets it and `ObjDesc.word4` as hooks from
`Game`. The shipped data has one door type missiles pass (`0x36e`). Evidence:
`tools/checks/missile-door.ts` (8 of 13 checks fail before, plus a data canary); the fact is
in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Recorded in Phase 9 step 12: door pass-through (the `DoorTOC` and `ObjDesc` checks for
missiles) and the magic damage and poison formulas, including Black Flame fireball healing
(`doc/CSBwin-src/Code11f52.cpp:1905+`, `:1523+`). Partly overtaken since:
`DetermineMagicDamage` exists now, and commit `83cccd0` worked on the door path. C2 paid
the monster arm; the door arm had neither the `DoorTOC & 2` pass-through test nor the
`HitDoor` with `DetermineMagicDamage + 1` force — a missile at a shut door just stopped.

</details>

##### C10 ✅ Phase 9.5 refinements

Re-audited 2026-09-23; one of the three was live, the other two were overtaken.

- ✅ **`LastMonsterAttackTime`'s source.** Paid in `dc627b9`. CSBWin's one writer is
  `MonsterAttacks` (`Monster.cpp:986`), which `MonsterAttack` has ported since Phase 12;
  the Phase 9.5 stand-in in `Game.applyMissileDamageToParty` stamped it on every missile
  that reached the party, too — even a champion's own spell — so `AdjustSkills` doubled
  experience and the facing reset held off for a monster that had not attacked. It is
  gone. Evidence: `tools/checks/last-monster-attack.ts` (1 of 2 checks fails before); the
  fact is in `doc/PROVEN_FACTS.md`.
- ✅ **The throw skill gain** was already CSBWin's: `Game.throwByCharacter` is
  `Mouse.cpp:723-757` line for line — 8 experience, +4 for a weapon, + `uByte3 / 4` when
  its class is 12 or less, into `AdjustSkills(chIdx, 10, …, ASW_ThrowByCharacter)` before
  the mastery is read. The move lock it ends with (`d.Word11712 = 4`) is C13's.
- ✅ **Spell skill selection** was ported with the spell table: `castSpell` reads
  `spellByte5` (or its filter override) into `DetermineMastery` and `AdjustSkills`, as
  `Magic.cpp:1218-1231` does. Re-reading `CastSpell` for it found other drift: C19.

<details><summary>original entry</summary>

"Refine spell skill selection once spell definitions exist, replace the throw skill gain
with CSBWin's tables, and refine the `LastMonsterAttackTime` source now that monster AI is
in." Possibly overtaken: `Game.awardThrowSkill` (`src/engine/Game.ts:2728`) now documents
itself as `AdjustSkills(chIdx, 10, experience, ASW_ThrowByCharacter)`. Check each of the
three against CSBWin, then close or narrow this entry.

</details>

##### C11 ✅ `DoesPartyHave` does not look inside chests

**Paid in `f1b71a4`.** `ActuatorSystem.doesPartyHave` is `Code11f52.cpp:3657-3715` now: the
30 possessions of every champion with hit points, then the cursor, each compared by
`GetBasicObjectType` and, when it is a chest (`OBJNI_CHEST`, 0x90, new), its contents too. Two
gaps beyond the entry: CSBWin's `goto` back into the loop checks **`d.objectInHand`** as
well (`:3707-3713`), which the port never did, and the champion filter is `HP() != 0`, not
the `alive` flag. The named hand/quiver fields are no longer read — `possessions[0]`, `[1]`
and `[8]` hold the same objects (D1). The shipped dungeon has 22 type-8 sensors. Evidence:
`tools/checks/does-party-have.ts` (4 of 7 checks fail before); the fact is in
`doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

`DoesPartyHave` (`doc/CSBwin-src/Code11f52.cpp:3658-3705`), which answers actuator type 8,
walks the 30 possessions of every champion with `HP() != 0` and, for each one whose basic
type is `objNI_Chest`, walks the chest's `contents()` chain too, comparing
`GetBasicObjectType` against the actuator's value at every step. The port's
`ActuatorSystem.doesPartyHave` checks the possessions and the three hand/quiver fields but
never opens a chest, and filters on `champ.alive` rather than on hit points. A key carried
in a chest therefore fails to trip a type-8 sensor that CSBWin would trip.

Port it line for line (the hand/quiver fields go with D1). Evidence: a `tools/` scenario
that puts the matching object in a carried chest and checks the actuator fires.

<sub>Found while paying B1, 2026-09-23.</sub>

</details>

##### C12 ✅ `SetTimer`'s duplicate-timer rules keep the wrong timer

Re-audited 2026-09-23 against `Timer.cpp:989-1130` read whole; every claim held.
**Paid in `21855bc`.** `TimerQueue.applyDuplicateTimerRules` is `SetTimer`'s head line
for line: a map timer meeting a map timer, and a `TT_1` meeting a `TT_DOOR` or a `TT_1`,
keep and return the old timer (a `TT_DOOR`'s `uByte9` flipped only if it was 2); only a map
timer meeting a `TT_1` deletes and requeues. The re-reading found one more thing: every
CSBWin timer search walks the **queue from its end** (`TIMER_SEARCH`, `:1209-1215`,
`:2924-2933`), not the slots. `TimerQueue.searchOrder()` is that order; the duplicate rules
and C8's DSA cloud-timer lookup (which took the lowest slot) use it. Evidence:
`tools/checks/timer-dedupe.ts` (3 of 15 checks fail before); the facts are in
`doc/PROVEN_FACTS.md`, and `doc/CSBWIN_TIMERS_REFERENCE.md` is corrected.

- ✅ **The sequence number was stamped at the wrong time.** Paid in `438c652`.
  `SetTimer` stamps `m_timerSequence++` on the slot it inserts into (`Timer.cpp:1189`;
  `SEQUENCED_TIMERS` is defined in `stdafx.h:17`), so a dropped duplicate consumes none and
  a requeued timer gets a fresh one. `TimerQueue.createTimer` stamped before the duplicate
  rules ran, and `addTimer` — which `MonsterSystem`, `MonsterAI` and `DsaSystem` call with
  their own entries — kept whatever the entry carried (the DSA passed 0, a requeued monster
  timer its old number). The stamp breaks ties between timers due on the same tick, and is
  saved (`gb2.TimerSequence`). `addTimer` stamps now. Evidence: `tools/checks/timer-dedupe.ts`
  case 6 (2 of 17 checks fail before). **Not ported:** the repack when the counter reaches
  0xffff (`:1136-1188`) — the port's counter grows past 16 bits, and a save masks it.

<details><summary>original entry</summary>

Seen while paying C1, not yet worked. `GameTimers::SetTimer` (`doc/CSBwin-src/Timer.cpp:989`)
resolves a clash by **keeping the timer already queued** and dropping the new one;
`TimerQueue.applyDuplicateTimerRules` mostly deletes the old one and queues the new.
`doc/CSBWIN_TIMERS_REFERENCE.md` → "Timer insertion and de-duplication" already states
CSBWin's rule correctly; the code does not follow it.

- *A map timer (5–10) meets a map timer* with the same time, level and cell (and, for
  `TT_STONEROOM`, `uByte8`): CSBWin copies the new `uByte9` into the existing one and
  returns it (`Timer.cpp:1022-1036`). The port deletes the existing and queues the new —
  which also keeps the new *function* where CSBWin keeps the old.
- *A `TT_1` meets a `TT_DOOR`* at the same time, level and cell: CSBWin keeps the
  `TT_DOOR`, setting its `uByte9` to `1 - new.uByte9` if it was 2, and returns it
  (`Timer.cpp:1073-1085`). The port flips the *new* timer's own `uByte9` and deletes the
  `TT_DOOR`.
- *A `TT_1` meets a `TT_1`*: CSBWin copies `uByte9` into the existing one and returns it
  (`Timer.cpp:1087-1092`); the port replaces it.
- The map-timer-meets-`TT_1` arm (`Timer.cpp:1038-1051`) and the new `TT_BASH_DOOR` rule
  match.

Re-read `Timer.cpp:989-1130` whole before changing anything — these line ranges come from
reading it in pieces. The visible effect is on doors toggled twice in one tick. Evidence:
a `tools/` scenario queuing each clashing pair and checking which entry survives, with
which function, `uByte9` and slot index. Size S–M.

</details>

##### C13 ✅ The rest of `MoveParty`: stamina, move delay, queue depth

**Paid in `1dc4c1d`, `49c953e`, `263786a`, `f9d72b0` and `bbbc8a0`,** one bullet each.
What they left is C20 and C21; found on the way, D5. All in `doc/CSBwin-src/CSBCode.cpp`
unless said otherwise.

- ✅ **Every attempted step costs stamina.** Before the destination is even looked at, each
  champion's `staminaAdjustment` is `sw((3 * load) / MaxLoad + 1)` (`:8175-8188`), and
  `AdjustStamina` is applied to each after the party-move filter (`:8216-8222`) — for a
  blocked step as much as for a taken one. Now `MovementSystem.chargeStamina`, at the top
  of every move (turns are free). Evidence: `tools/checks/party-collision.ts` case 7 (4 of
  26 checks fail before); the fact is in `doc/PROVEN_FACTS.md`.
- ✅ **The move delay.** A taken step sets `d.partyMoveDisableTimer` to the slowest living
  champion's `TimeToMove` (`:8413-8434`); the tick counts it down (`:699-702`), and
  `Mouse.cpp:1606-1625` refuses a step while it is non-zero — or while `d.Word11712` is
  set and the step heads towards `d.Word11714`. The wall-clock gate (`Party.canMove`,
  `GAME_TIMING.MOVE_DELAY_MS` / `TURN_DELAY_MS`, `lastMoveTime`) is gone:
  `Game.processMovementQueue` (since C21, `Game.handleMouseEvents`) holds a step on the timer or the throw lock, and any turn or
  step on `HandleMouseEvents`' one-event-per-tick `lastTime` (`Mouse.cpp:1596-1604`);
  `Game.setPartyMoveDelay` is the step's tail, `CharacterStats.timeToMove` is
  `TimeToMove`, and a throw sets the lock. All three words are `PartyState` fields, saved
  and loaded, which closes `PLAN.md` Phase 10's gap. Evidence:
  `tools/checks/party-collision.ts` case 8 (it crashes before), `tools/checks/live-save-file.ts`
  (2 of 191 checks fail before); the fact is in `doc/PROVEN_FACTS.md`. **Left:** CSBWin
  stamps `lastTime` for every mouse event, clicks included — C21.
- ✅ **The key queue holds two keys, not three.** `CSBUI.cpp:154-156` is a 3-slot ring that
  refuses a key when `next == keyQueueStart` (`:1152-1160`), and the mouse queue each key
  moves on to at once is too: `TAG0196da` refuses a key when `MouseQEnd + 2 ==
  MouseQStart` (`CSBCode.cpp:8526-8530`). `Game.enqueueMovement` now lets two in.
  Evidence: `tools/checks/party-collision.ts` case 9 (1 of 39 checks fails before).
  **Left:** CSBWin's mouse queue also carries clicks — C21. **Corrected by C21:** the
  mouse queue is 8 long, not 3 (`Data.h:1528` leaves `NoKeyQue` undefined, so `:1530` is
  the dead branch), and the key queue in front is emptied one key per message, so
  *seven* moves wait. The bullet's premise was wrong; case 9 now checks seven.
- ✅ **`DiscardAllInput()` on a level change** (`:633`, after `LoadPartyLevel`): stairs, a
  pit or a teleporter to another level also throw away queued input. The port loads the
  level on arrival, so `Game.loadPartyLevelIfChanged` notes the change and `gameTick`
  discards at its top, where CSBWin does. Evidence: `tools/checks/party-collision.ts` case
  10 (1 of 43 checks fails before); the fact is in `doc/PROVEN_FACTS.md`. Found on the
  way: a level change made *inside* `ProcessTimers` is loaded at the next tick, not at
  once — C20.
- ✅ **Room type 7.** `D5W` is set only for stone, a shut door and a solid false wall
  (`:8311-8348`), so any other room type is entered; `DungeonState.isWalkable` refused
  `RoomType.EMPTY` (7). Neither `dungeon.dat` nor any of the fourteen saves has a type-7
  cell, so nothing loaded changes. `MovementSystem.handleMovement` now computes `D5W` as
  CSBWin does, and `isWalkable` (its only caller) is gone. Evidence:
  `tools/checks/party-collision.ts` case 11 (1 of 45 checks fails before). Found on the way:
  D5.
- 🚫 `CallPartyMoveFilter` (`:8206`) is a DSA filter — G2's kind, and no loaded dungeon
  defines one. Its `PM_SETDELAY` / `PM_ADDDELAY` arms (`:8209-8215`, `:8423-8433`) are
  G2's too.

##### C14 ✅ `DrawClouds`: size, colour map, lightning position, the cell under the party

**Paid in `a1ed379`.** All five, and two more found on the way: a poison cloud drew
graphic 354 (one of the party-cell graphics) instead of `TAG005088`'s `348 + Smaller(3, 2)`
= 350; and `Word7246` was read as its declared 12 words, but lightning indexes it up to
word 20, running on into `Word7222`. So lightning one and two cells ahead had scale 0 and
was never drawn. The cell under the party is now a tiling of the whole viewport
(`d.Word2530`), not a 96×30 box. One assumption remains, recorded in the code and in
`doc/PROVEN_FACTS.md`: C++ does not fix the order of `TAG008c98`'s two random arguments,
and the port draws them right to left. The graphics are 48×31, not 48×32; CSBWin pads the
missing row, and the tiling never reaches it. Evidence: `tools/checks/cloud-draw.ts`
sections 4-7 (47 of 90 checks fail before). No golden frame shows a cloud; they all
still pass.

<details><summary>original entry</summary>

Found while porting C6's placement block; nothing here is fixed. All in
`doc/CSBwin-src/Code51a4.cpp`, against `BytecodeInterpreter.drawClouds`.

- **The size clamp is on the wrong thing.** `TAG005088` clamps the *scale* to 32 (`:29`);
  the port clamps the resulting width and height to 1..32, which crops every full-size
  cloud whose graphic is larger (graphic 348's table size is 160×111).
- **The scale.** `w_156 = Larger(4, Byte5758[group] * Larger(48, value+1) >> 8) & 0xfffe`
  (`:251-254`). The port has no `& 0xfffe`, and treats `value == 0` as a full-size 32 that
  CSBWin does not have.
- **The shrink's colour map** is `d.IdentityColorMap` for types 0-2 (`:52-58`); the port
  passes `colorMapMedium`.
- **Lightning (type 100) is placed from `d.Word7246`** (`:143`, `x, y, scale`); the port
  takes only the scale from it and the position from `Word7042` / `Word7162`.
- **The cell under the party** (`RelativeCellNumber == 12`, `:178-218`) picks graphic
  `351 + 3·D4W + (value>>5 != 0) + (value>>5 > 3)`, where `D4W` is the type index with
  type 40 counted as 2 (`:180-191`), shrinks the type-40 one through
  `d.Byte5712`, and draws it with `TAG008c98` at `STRandom0_3() + 87`, `STRandom() & 63` —
  two more viewport-stream draws. The port blits `351 + typeIndex` into a fixed rectangle.

Extend `tools/checks/cloud-draw.ts`, which already stubs the tables it needs.

</details>

##### C15 ✅ A DSA cell move does not go through `MoveObject`

**Paid in `ff6e578`.** CSBWin's low-level `MoveObject` is ported once for objects, as
`TimerSystem.moveObject` (`doc/CSBwin-src/Code11f52.cpp:2831`), and `DsaSystem.
findCellSource` / `findCellDestination` lift and set down through it and, for a monster,
through `MonsterSystem.moveMonster` (its monster branch), with `groupIndex` reset to
`0xd8` / `0xff` off the party's level (`MoveObject.cpp:504-521`) and a same-level monster
moved square to square (`:539-571`). The pads' `unchangedRoom` is now "the party stands
here", not "source is destination". Evidence: `tools/checks/dsa-move.ts` sections 4-8 (8 of
26 checks fail before); the fact is in `doc/PROVEN_FACTS.md`. Found on the way: C22, C23.

<details><summary>original entry</summary>

`FindCellSource` / `FindCellDestination` (`doc/CSBwin-src/MoveObject.cpp:166-251`,
`:460-600`) move the object with the low-level `MoveObject` (`Code11f52.cpp:2831`) —
`MoveObject(obj, x, y, -1, 0)` to lift it, `MoveObject(obj, -1, 0, x, y)` to set it down —
so an object a DSA drops on an open teleporter or pit is carried on at once, and a
monster moved within the party's level keeps its state: it is not lifted at the source
(`:205-219`), `MoveObject(object, srcX, srcY, x, y)` moves it, and its AI timers follow
(`:547-570`); moved off that level its `groupIndex` becomes `0xd8` / `0xff` (`:506-520`).
`DsaSystem.findCellSource` / `findCellDestination` splice the chain directly
(`removeObjectFromCell`, `addObjectToCell`) with only the actuator triggers, and have no
monster arm. The port's equivalent of `MoveObject`'s cell-effect loop is
`TimerSystem.resolveCellEffects`. Found while paying C8; no dungeon here has a DSA, so a
`tools/` scenario has to build one (`tools/checks/dsa-move.ts` shows how).

</details>

##### C16 ✅ Freed database slots are never reused

**Paid in `6ae2afa`.** `DungeonState.findEmptyDBEntry` is `FindEmptyDBEntry`
(`doc/CSBwin-src/data.cpp:921-995`): the lowest record from index 1 whose link is `RNnul`,
else an append, which is the index `Enlarge` returns. Every allocator goes through it —
`MonsterSystem.findEmptyCreatureEntry`, `MonsterDamage.createDroppedRecord`,
`MonsterAttack.createBonesRecord`, `TimerSystem`'s missile and cloud records,
`Game.createMiscObject`, `constructPredefinedMissile` and `DsaSystem.copyItem` — and an
append keeps `count` and the header's `objectCounts` equal to the records, which the
image writer declares (`MonsterSystem`, `MonsterDamage` and the bones never bumped the
header). `AllocateIndirectIndex` needed nothing: the port has no live indirect index, and
the save writer numbers its own (see `doc/PROVEN_FACTS.md`, "An RN in block 10 or block 13
cannot be byte-identical"). C8's deferred deletes are now observable:
`tools/checks/dsa-delete.ts` shows a condemned record keeps its link for the rest of the run,
so nothing can take it. ⚠️ At 1024 records the allocator returns `null`, where CSBWin
calls `MakeMoreRoomInDB` (`Character.cpp:183`) — unported, and unreachable in the shipped
dungeons. Evidence: `tools/checks/db-reuse.ts` (7 of 11 checks fail before; the first arrow
`dungeon.dat` makes is weapon 105, not 107); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

CSBWin allocates a record with `FindEmptyDB<n>Entry` → `DATABASES::FindEmptyDBEntry`
(`doc/CSBwin-src/data.cpp:921`), which takes a freed slot (`DeleteDBEntry`, `data.cpp:997`,
is what frees one), and `AllocateIndirectIndex` (`SaveGame.cpp:2313`) reuses freed indirect
indices. Read both before porting; this entry has not audited their search order. Every allocator in the port appends instead — `MonsterSystem.
findEmptyCreatureEntry`, `MonsterDamage.createDroppedRecord`, `TimerSystem.
createCloudRecord` / `createMissileRecord`, `Game.createMiscObject`, `DsaSystem.copyItem`
— and two of them say so with a ⚠️. Object indices therefore drift from CSBWin's as soon as
anything is freed, which matters to a written save (Phase 10) and makes C8's deferred
deletes observable. Port `FindEmptyDB<n>Entry` once, in `DungeonState`, and route every
allocator through it.

</details>

##### C17 ✅ `WiggleEverything` leaves a moved cloud's timer behind

**Paid in `7bfa5f6`.** `TimerSystem.wiggleObject` now retargets every `TT_25` / `TT_24`
naming a moved cloud (corner ignored, as CSBWin's `RN` compare does) to the new square,
level and placed ID (`Timer.cpp:2491-2510`). Evidence: `tools/checks/wiggle-cloud.ts` (2 of 12
checks fail before); the fact is in `doc/PROVEN_FACTS.md`. Found on the way: C18.

<details><summary>original entry</summary>

When a teleporter or pit opens under objects, `WiggleEverything` (`doc/CSBwin-src/
Timer.cpp:2428-2512`) moves each one with `MoveObject` and, for a cloud, retargets every
`TT_25` / `TT_24` naming it to `d.NewX`, `d.NewY`, `d.NewPos`, `d.NewLevel` (`:2491-2510`),
as it does a missile's timer (`:2476-2489`). `TimerSystem.wiggleObject` does the missile
and not the cloud, so a fireball's cloud carried off by a teleporter keeps burning at the
old square, and `processTT_25` then fails to unlink it (the ID it holds has the old
corner) and frees a record still linked in the new cell. The C8 cloud fix in `DsaSystem.
findCellDestination` is the pattern.

</details>

##### C18 ✅ A Fluxcage never expires, and frees door record 0

**Paid in `51223c3`.** Found while paying C17. `CreateFluxcage` puts the cage in the
`TT_24`'s `timerObj8()` (`Code11f52.cpp:1570`) and `TT_24` removes and frees that object
(`CSBCode.cpp:6553-6569`). `TimerSystem.createFluxcage` put it on `TimerEntry.object`, as
every `TT_25` does, but `processExpireObject` read `timerWord8` — 0 on a live timer — so the
cage stood forever and `DeleteDBEntry(0)` freed door record 0, cutting that cell's chain
after the door. Only a cage restored from a save worked: `restoreTimerQueue` fills both.
`processExpireObject` reads `object` now. Evidence: `tools/checks/clouds.ts` section 6 (3 of
27 checks fail before).

##### C19 ✅ `CastSpell` under a spell filter's overrides

**Paid in `2a5761e`.** `Game.castSpell` handles the filter's `action` first — its message
prints for a dead caster, and an action with no message (8 and up) now casts instead of
aborting — then takes the difficulty from the spell's own `skillRequired` and the
`missileType` from the filter. Evidence: `tools/checks/cast-spell.ts`, new (5 of 8 checks
fail before); the fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Found re-reading `CastSpell` (`doc/CSBwin-src/Magic.cpp:1092`) for C10. All three need a DSA
spell filter (`DsaSystem.processSpellFilter`) to show, and no dungeon here defines one, so a
`tools/` scenario has to build it (`tools/checks/dsa-move.ts` shows how) or call
`Game.castSpell` with the parameters directly.

- **The difficulty uses the spell's own skill.** `D4W = pSpell->skillRequired + spellPower`
  (`:1209`) — the unfiltered value — while the experience's middle term uses the filtered
  `skillRequired` (`:1212`). `Game.castSpell` builds both from the filtered one.
- **`missileType` can be overridden** (`:1203-1207`); `Game.castSpell` always reads
  `spell.word6`, so a filter cannot change what a class-2 or class-3 spell does.
  (The class-1 potion type is `pSpell->word6` in CSBWin too, `:1252`.)
- **The abort messages come before the caster checks.** CSBWin handles
  `spellParameters.action` (`:1112-1151`) before `chIdx >= d.NumCharacter` and `HP() == 0`
  (`:1152`, `:1155`); the port checks the caster first, so a filter's abort on a dead caster
  prints nothing.

</details>

##### C20 ✅ A level change inside `ProcessTimers` waits for the next tick

**Paid in `9e742ac`.** `Game.gameTick` now loops as CSBWin's main loop does:
`loadNewPartyLevel()` (`tag0006a4`: load, discard) at the top, then `processTimers` again
for as long as a pass changed level. The port resolves the pit/teleporter chain when the
party moves, so the `MoveObject(RNnul, -1, 0, x, y)` placement has nothing left to do.
Evidence: `tools/checks/party-collision.ts` case 12, new: a `TT_PIT` opens under a party
with a turn queued. Before the fix, 3 of its 4 checks failed, and the turn ran on the new
level. The fact is in `doc/PROVEN_FACTS.md`.

<details><summary>original entry</summary>

Found paying C13. The main loop runs `ProcessTimers()` and then
`if (d.newPartyLevel != -1) goto tag0006a4;` (`doc/CSBwin-src/CSBCode.cpp:645`): a timer that
moves the party to another level — a pit opening under it, a teleporter an actuator
switched on — has the level loaded, the party placed with `MoveObject(RN(RNnul), -1, 0, x,
y)`, input discarded, and `ProcessTimers` run again, all in the same tick (`:625-645`).
`Game.gameTick` calls `loadPartyLevelIfChanged` only before `processTimers`, so such a level
is loaded, and its input discarded, a tick late; a turn or step queued in between runs on
the new level first. Evidence: a `tools/` scenario with a pit timer under a party that has
a turn queued (`tools/checks/party-collision.ts` case 10 is the pattern).

</details>

##### C21 ✅ Clicks do not go through the input queue

**Paid in `efce48e`.** `Game` now has CSBWin's one
mouse queue, a ring of `MOUSEQLEN` entries, and it holds keys and clicks alike.

- **The queue is 8 long.** `MOUSEQLEN` is 8, not 3. `Data.h:1528` leaves `NoKeyQue`
  undefined, so `:1530` is dead, and this entry and C13 had cited it without its
  `#ifdef`.
- **Queueing.** `Game.onMouseClick` queues a button while fewer than six entries wait
  (`OnMouseClick`, `CSBCode.cpp:7670-7783`). `Game.onMouseUnClick` queues `0x0add` while
  fewer than seven wait (`:7640-7663`). `Game.enqueueMovement` refuses a key only when
  seven wait (`TAG0196da`, `:8526-8530`).
- **Dispatch.** `Game.handleMouseEvents` replaces `processMovementQueue`. It handles the
  head once per tick and turns and steps itself (`Mouse.cpp:1689-1709`); every other
  button goes to the UI's `handleMouseButton`, and the button-up goes to
  `handleMouseUnclick`. Every button stamps `lastTime`. The button-up does not, and it
  lets the next entry through in the same pass (`:1662-1688`). A held step blocks
  whatever is behind it.
- **The viewport.** Button 80, `HandleClickInViewport`, is now `src/ui/events.ts`'s
  `handleClickInViewport`, reached through the queue instead of from the DOM event.
  *Regression:* the move dropped the old `isWallDecorationHit(…) && handleWallClick()`
  fall-through. An alcove's wall decoration then swallowed every pickup from the alcove.
  Fixed by porting CSBWin's button order, objects before the wall
  (`resolveEmptyHandedViewportClick`, `tools/checks/viewport-click.ts`).
- **The on-screen arrows (buttons 1-6).** They were queued but dropped; they now work.
- **Removed.** `ui.mouseQueue` and the renderer's `processMouseQueue` are gone.

Still direct, and deliberately so:

- the save menu and the Reincarnate screen, which are modal;
- the panel keys in `ui/Keyboard.ts`, whose module comment gives the reason.

**Evidence:**

- `tools/checks/mouse-queue.ts` is new, with 15 checks. It crashes before the fix, which
  had no queue API.
- `tools/checks/party-collision.ts` case 9 now expects seven keys.
- `npm test -- --frames` passes. The frames click through the queue.
- Probed live: the forward and turn-left arrows move the party.

The fact is in `doc/PROVEN_FACTS.md`, and the "two moves" entry there is corrected.
Found on the way: C26, G9, and additions to G5 and G6.

<details><summary>original entry</summary>

Found paying C13. CSBWin has one mouse queue (`MOUSEQLEN` 3, `doc/CSBwin-src/Data.h:1530`)
for keys and clicks alike: a click is queued only into an empty queue, with its button-up
behind it (`CSBCode.cpp:7695-7713`, `:7645-7661`), and `HandleMouseEvents` handles one entry
per tick, stamping `lastTime` for each (`Mouse.cpp:1596-1604`). The port queues only
movement (`Game.movementQueue`) and handles clicks as they arrive, so a click neither waits
for the tick nor holds the next turn or step back to the next one, and a click does not
fill a queue slot a key would then be refused. Porting it means turning
`processMovementQueue` into `HandleMouseEvents`' dispatcher for every button. Size M; no
save or `tools/` scenario depends on it yet.

</details>

##### C26 ✅ The disk icon ignores `HandleMouseEvents`' eye and mouth gate

**Paid in `7d19e09`.** `handleMouseButton` now returns
before the 140 branch while `ui.pressingEye` is set (`Mouse.cpp:1818-1819`). The port
has no pressed mouth, so only the eye is tested.

Evidence: `tools/checks/mouse-queue.ts` case 8 queues 71 and then 140, once without a
button-up between them and once with one. Before the fix, 1 of 17 checks fails.

<details><summary>original entry</summary>

Found paying C21. After button 81, `HandleMouseEvents` returns at once, stamping
`lastTime`, while `d.PressingEye` or `d.PressingMouth` is set
(`doc/CSBwin-src/Mouse.cpp:1818-1819`). Every later button is swallowed: 140 (the disk
icon), 145-148, 200-216.

The port's `handleMouseButton` (`src/renderer/ui/Mouse.ts`) handles 140 without that
test. It also has no `pressingMouth` at all: the mouth is handled on the press
(`handleMouthPress`).

The fix is one guard before the 140 branch. Evidence would be a `tools/` check that
queues 71, then 140, with no button-up between, and sees no save menu requested.

</details>

##### C22 ✅ A monster's own move presses no pads, and drags timers the AI does not

**Paid in `593febf`.** `MonsterSystem.moveMonster` lifts and sets down a group that does
not levitate through `PlaceOrRemoveObjectInRoom` (a new `triggerObjectMove` hook, wired to
`ActuatorSystem.triggerObjectMove`): leaving with `unchangedRoom` = "the party stands
here", arriving with `false` (`doc/CSBwin-src/Code11f52.cpp:3322`, `:3427`); a flying
group presses nothing (`:3309`, `:3421`). The removal now comes before the occupancy test,
as in CSBWin (`:3292-3331`, `:3370-3393`), so a group that goes into abeyance releases its
pad. The AI-timer retarget left `moveMonster`: CSBWin's AI re-aims only `timer_70`
(`Monster.cpp:1715`, `:2109`, `:2444`, `:2912`), which `MonsterAI` already did, and the
DSA's re-aim of the rest (`MoveObject.cpp:539-571`) now lives in `DsaSystem.
findCellDestination`. Evidence: `tools/checks/monster-pad.ts`, new, on a real type-1 pad
(6 of 12 checks fail before); `tools/checks/monster-move.ts` case 1 now expects the timers to
stay; `tools/checks/dsa-move.ts` section 6 still passes. The fact is in
`doc/PROVEN_FACTS.md`, and the "must retarget" entry there is corrected. Found on the way:
C24.

<details><summary>original entry</summary>

Found paying C15. `MoveObject`'s monster branch (`doc/CSBwin-src/Code11f52.cpp:3362-3459`)
removes and places a non-levitating group through `PlaceOrRemoveObjectInRoom`
(`:3322`, `:3427`), so a monster walking onto or off a pressure pad fires it.
`MonsterSystem.moveMonster` splices the chains with `removeObjectFromCell` /
`addObjectToCell` and calls no actuator at all. It also points the group's AI timers at
the new square whenever its `ITEM16` did not change — which is what the *DSA* does after
`MoveObject` (`MoveObject.cpp:539-571`), not `MoveObject` itself — so every AI step does
it too, where CSBWin's AI (`Monster.cpp:1715`, `:2109`, `:2444`, `:2912`) leaves the other
timers behind. The DSA path now relies on it (C15); moving the retarget out means giving
`DsaSystem.findCellDestination` its own. Needs a `tools/` scenario with a pad under a
monster's path (`tools/checks/dsa-move.ts` sections 6-8 build a group). Size M.

</details>

##### C23 ✅ The other object movers are not `MoveObject` either

**Paid in `298d869`, `42ccf79`, `68a21b5`, `e1cf787` and `9152c0b`.** Every mover CSBWin sends
through `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2831`) now goes through
`TimerSystem.moveObject` or, for a group, `MonsterSystem.moveMonster`:

- **`298d869`.** `TimerSystem.wiggleEverything` (`WiggleEverything`, `Timer.cpp:2428-2512`)
  moves each object through `moveObject`, walking the chain as CSBWin does, and re-aims a
  missile's timer from what `moveObject` reports. Evidence: `tools/checks/wiggle-objects.ts`
  (4 of 9 checks fail before).
- **`42ccf79`.** It moves the first monster through `moveMonster`, which gained the
  unchanged-room return (`Code11f52.cpp:3218-3248`). Evidence: `tools/checks/wiggle-monster.ts`
  (5 of 9 fail before).
- **`68a21b5`.** `Game.dropObjectFromCursor` is `moveObject(obj, -1, 0, x, y)`
  (`Mouse.cpp:882-890`) and `TimerSystem.dropMissileObject` is `moveObject(obj, -2, 0, x, y)`
  (`Timer.cpp:151-159`). Both had placed with `unchangedRoom` false where `MoveObject` passes
  "the party stands here" (`:3468-3483`), and the cursor drop had turned the item's corner on
  a relative teleporter although `oldX == -1` (`:3035-3041`). `resolveDroppedObjectPosition`
  is gone. Evidence: `tools/checks/drop-move-object.ts`, new (3 of 8 fail before).
- **`e1cf787`.** `MonsterDamage.deleteMonster` lifts the group with `moveMonster(obj, x, y,
  -1, 0)` (`:1038`, a new `moveMonster` hook), and `moveMonster` has the `newX < 0` path:
  `CheckMoveFromMissile` (which finds the cleared hit points and returns at once,
  `:2593-2596`), the lift through `PlaceOrRemoveObjectInRoom` or, levitating,
  `RemoveObjectFromRoom`, then `return 0` (`:3292-3332`). So a group killed on a pad releases
  it. Evidence: `tools/checks/monster-pad.ts` section 6 (1 of 4 fails before).
- **`9152c0b`.** `resolveCellEffects` has the stairs arm (`:3143-3166`): a monster or an
  object, not the party or a missile, goes one level down unless bit 2 says up, then one
  square out through `ExitStairsDirection`, its corner turned to face the stairs; the loop
  goes on from there. The `oldX != -1` teleporter rule moved into the loop, since the stairs
  turn a corner whatever `oldX` is. Evidence: `tools/checks/stairs-move.ts`, new (5 of 6 fail
  before).

The facts are in `doc/PROVEN_FACTS.md`. Found on the way: C25.

<details><summary>original entry</summary>

Found paying C15, which ported `MoveObject` for objects once, as `TimerSystem.moveObject`.
The other callers hand-rolled it, and each differed from it somewhere: the object and the
monster wiggle; `Game`'s drop from the cursor and `TimerSystem.dropMissileObject`, which
passed `unchangedRoom = false` and turned a dropped item's corner on a relative teleporter
although `oldX == -1`; `resolveCellEffects` had no stairs arm; and
`MonsterDamage.deleteMonster` took the group off its square with `removeObjectFromCell`
where CSBWin calls `MoveObject(obj, x, y, -1, 0)`, so a monster killed on a pad left it
pressed (found paying C24). Size M.

</details>

##### C24 ✅ `moveMonster`'s return value, and what the AI does with it

**Paid in `6480bd4`.** `MonsterSystem.moveMonster` returns `{ code, position }`: CSBWin's
value (`LOCAL_14`, or 1 for a group that left the dungeon) and `d.NewX/NewY/NewLevel`. The
three `MonsterAI` callers end the turn on any non-zero `code` and re-aim `timer_70` to
`position` (`Monster.cpp:1715`, `:2109`, `:2444`, `:2912`); the DSA and `createMonster`
test `code !== 0` too, so a group made on the party's level is `RNnul` with no sound, as
in CSBWin (`Monster.cpp:222-231`), and an audible generator now queues its own
(`Timer.cpp:1797-1800`). `code` comes from `TeleportMonster` only (`Code11f52.cpp:3023`),
the attach is `code++` (`:3411`), and `moveMonster` no longer writes `uByte10/11` or
`ubPrev*`. The pit fall hurts the group at its old square with `P5 = 0` (`:3131-3132`),
drops dead members' remains where it landed (`TAG00b522`, `:3138`), and a fatal fall or a
forbidden level deletes the group after the loop (`:3182-3211`); a chained teleport reads
the attached level's `ITEM16` (`:3023`). `DamageMonsterGroup` now empties the deferred
droppings first (`:1368`). Evidence: `tools/checks/monster-move-code.ts`, new (13 of 17
checks fail before); `tools/checks/monster-move.ts` case 1 (2 of 18 fail before);
`tools/checks/watch-monsters.ts` now finds groups on the map instead of in `uByte10/11`; the other
tools that made a group get it through `tools/lib/createMonster.ts`. (The new tool joined
`tools/run-checks.mjs`'s list only in `42ccf79`: the runner has no discovery.) The facts are in
`doc/PROVEN_FACTS.md`, and the older return-value entry there is corrected. Found on the
way: the `DeleteMonster` bullet under C23, and `ProcessMonsterDeleteFilter` under G2.

<details><summary>original entry</summary>

Found paying C22. `MoveObject`'s monster branch returns `LOCAL_14`
(`doc/CSBwin-src/Code11f52.cpp:3458`) and each AI caller stops on anything non-zero
(`Monster.cpp:1715`, `:2109`, `:2444`, `:2912`); the port's value and its callers differ:

- **The AI ignores a non-zero `code`.** `MonsterAI` returns only on `removed`, so after a
  teleport or a level change (`code >= 1`, when `moveMonster` has already started fresh
  timers and deleted the old square's) it goes on, re-aims `timer_70` at the square it
  asked for and re-queues it. CSBWin drops `timer_70` there. It also re-aims to `newX`
  where CSBWin uses `d.NewX` — the same square whenever `code` is 0.
- **`resolveMonsterDestination`'s `code` is 1 for any move**, a pit fall included, where
  `LOCAL_14` is set only by `TeleportMonster` (`:3023`); and an attach sets `code = 1`
  where CSBWin does `LOCAL_14++` (`:3411`), so a group teleported onto the party's level
  gets `2` and `ClearAttacking_DeleteMovementTimers(&d.Item16[0], …)` (`:3446-3448`) —
  slot 0's attacking bits, a CSBWin quirk to keep.
- **`moveMonster` rewrites the `ITEM16`'s `uByte10`/`uByte11` and `ubPrevX`/`ubPrevY`.**
  `MoveObject` touches neither; `uByte10`/`uByte11` is set only by `AttachItem16ToMonster`
  (`CSBCode.cpp:6147-6149`), and a frightened group heads back to it
  (`Monster.cpp:2277-2281`), so in the port it heads for the square it is on. `ubPrev*` is
  the AI caller's to set, which `MonsterAI` does.
- **A pit that kills the whole group, or a level the monster is not allowed on**, deletes
  it after the loop, dropping its remains (`LOCAL_18`, `:3134-3135`; `:3151-3180`). The port
  ignores `monsterFallsIntoPit`'s result, and `applyTeleporterToMonster` refuses the
  teleport instead (`TimerSystem.ts`, `blocked`), leaving the group on the teleporter.

Each is small; together they are one pass over `moveMonster` and its three `MonsterAI`
callers. Extend `tools/checks/monster-pad.ts` or `tools/checks/monster-move.ts`. Size M.

</details>

##### C27 ✅ A dead champion keeps a ghost of slot 8

**Paid in `3eeca47`.** Found splitting D1. `Game.dropAllPossessions` emptied the
array and the `weaponHand` / `shieldHand` mirrors but not `quiver`, and
`ui/Character.getChampionPossession` falls back to `quiver` for slot 8 when the array
reads null — so after death the inventory still showed whatever had been in slot 8,
though it now lay on the floor. CSBWin's `DropAllPossessions` empties all thirty
(`doc/CSBwin-src/Character.cpp:2502-2523`). The fix clears the mirror; D1 then deletes
it. Evidence: `tools/checks/champion-death.ts` arms slot 8 too and reads every slot back
through the UI's reader (3 of 41 checks fail before).

##### C28 ✅ `DropAllPossessions` is not CSBWin's

**Paid in `7abaf1a`.** `Game.dropAllPossessions` walks `d.DropOrder`, now read from graphic `0x232`
(byte 244, `UITables.graphic232.dropOrder`, passed in `TimerTables`), takes each slot
out through `removeCharacterPossession`, turns the object to the champion's corner and
sets it down with `timerSystem.moveObject(obj, -1, 0, partyX, partyY)`. `Game` throws if
the table was not handed in, rather than dropping nothing; eight tools that kill a
champion now pass it. The drop is only as faithful as `removeCharacterPossession`, which
is a bare slot clear — C30. The table and the order are in `doc/PROVEN_FACTS.md`.
Evidence: `tools/checks/champion-death.ts` section 7 — `DropOrder` is a permutation of
0-29 (the canary), the chain lists the objects in `DropOrder` order, and a possession
dropped over an open pit falls through it (2 of 45 checks fail before).

<details><summary>original entry</summary>

Found paying C27. CSBWin's `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2502-2523`)
takes the slots in `d.DropOrder[30]` order, through `RemoveCharacterPossession` (so the
load, the light and the portrait hands are updated), turns each object to the champion's
`charPosition` and sets it down with `MoveObject(obj, -1, 0, partyX, partyY)` — so the
drop presses pads and falls through pits like any cursor drop. `Game.dropAllPossessions`
walks slots 0-29 in array order, writes the array directly, and splices each object in
with `addObjectToCell`. Visible as the stacking order of a dead champion's belongings, and
on a pad or a pit. `DropOrder` must come from the game data or CSBWin, not be guessed.
Extend `tools/checks/champion-death.ts`. Size S-M.

</details>

##### C29 ✅ The save writer writes an empty cursor as `RNempty`

**Paid in `3b76c49`.** Found splitting D2b. `SaveGamePayload` wrote
`(party.objectInHand ?? 0)`, so an empty cursor went into the index pre-pass and out
through `encode` as 0, `RNempty`. CSBWin writes `d.objectInHand.ConvertToInteger()`
(`doc/CSBwin-src/SaveGame.cpp:1058`), `RNnul` for an empty hand, and its loader converts
anything that is not `RNnul` (`:2966-2973`), so a file this port wrote with an empty
cursor would have loaded in CSBWin with `RNempty` in hand. Every committed save with an
empty hand holds `0xffff`. The port's own reader accepted 0 as empty, which is why no
round trip caught it. Evidence: `tools/checks/live-save-file.ts` now reads the written word
back (2 of 193 checks fail before). The fact is in `doc/PROVEN_FACTS.md`.

##### C30 ✅ `removeCharacterPossession` is a bare slot clear

**Paid.** `Game.removeCharacterPossession` now does what CSBWin's does to the object and
the party: round the neck an Illumulet gets `value(0)` and takes `d.Word1074[2]` off
`d.Brightness` (the table is passed in `TimerTables`; `Game` throws if it is missing when
an Illumulet comes off), a Jewel Symal gets `value(0)`; in the weapon hand a scroll
closes; in either hand a torch goes out — all tested on `RN::NameIndex`, as CSBWin does.
So a champion who dies wearing an Illumulet no longer leaves the party lit, and a thrown,
shot or dropped torch no longer burns on the floor. The palette, hands, backpack redraw,
`charFlags` and `load` have no counterpart (derived every frame, or re-summed). Left out
and recorded in C34: `AdjustStatsForItemCarried` (C32), `TAG01b1c0` and `RepackChest`
(both read UI state). Evidence: `tools/checks/champion-death.ts` section 8 kills one
champion wearing an Illumulet with a lit torch and an open scroll in hand, and one
wearing a Jewel Symal (5 of 56 checks fail before; the weapon and misc types are found
through `ObjDesc`, and come out as DM's torch 2, Jewel Symal 2, Illumulet 3).

Found paying C28. `Game.removeCharacterPossession` only writes `RNnul` into the slot.
CSBWin's `RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1827-1935`) also:
for slot 10, an Illumulet gets `value(0)` and takes `d.Word1074[2]` off `d.Brightness`, a
Jewel Symal gets `value(0)`; for slot 1, sets `CHARFLAG_weaponAttack`, calls `TAG01b1c0`
when this champion's attack menu is open, and closes a scroll (`open(false)`); for either
hand, a torch goes out (`litTorch(0)`); when the champion's inventory is open, a chest in
slot 1 is repacked; and `AdjustStatsForItemCarried(…, -1, …)` (C32). The load needs
nothing — `CharacterStats.characterLoad` re-sums. Its callers are the throw, the shot,
the two hand refills and, since C28, `DropAllPossessions`, so a champion who dies
wearing an Illumulet leaves the party's light raised, and a thrown or dropped torch stays
lit. The UI's `setChampionPossession` does the Illumulet's brightness and the torch, but
not the rest, so the two paths disagree. Port it once, for the engine, with a check that
kills a champion wearing an Illumulet and holding a lit torch.

##### C31 ✅ A dead champion's bones are not set down by `MoveObject`

**Paid.** `MonsterAttack.killCharacter` turns the bones to the champion's corner and sets
them down through a new required `moveObject` hook (`TimerSystem.moveObject`), then
registers the expool record with the same RN, as CSBWin does. The old path deleted the
record when `addObjectToCell` failed; CSBWin has no such branch. Evidence:
`tools/checks/champion-death.ts` section 7 — dying over an open pit, no bones stay on the pit,
they land on the level below, still paired in the expool and in the champion's corner
(2 of 49 checks fail before).

Found paying C28. `KillCharacter` sets the bones down with `MoveObject(objD4, -1, 0,
d.partyX, d.partyY)` (`doc/CSBwin-src/Character.cpp:2641-2650`), like the possessions,
so over an open pit they fall. `MonsterAttack.killCharacter` splices them in with
`addObjectToCell`. `tools/checks/champion-death.ts` section 7 already stands the party on
an open pit; assert where the bones end up, and check the expool record still pairs
them.

##### C32 ✅ `AdjustStatsForItemCarried` is not ported

**Paid.** `src/engine/AdjustStatsForItemCarried.ts` is a line-by-line port, `NameIndex`
and the `cursed()` bit included, over the port's wrapping `ATTRIBUTE` bytes
(`attributes.ts`) and an `sw` `maxMana`. Every writer of a champion's slots now calls it:
`Game.removeCharacterPossession` (`-1`), `Game.setChampionHand` (`+1`, the hand refills and
Zokathra), the Hall of Champions recruit (`+1` per object, as `AddCharacter` does through
`AddCharacterPossession`, `Character.cpp:790`), the UI's `setChampionPossession` and
`DsaSystem.setChampionPossession` (`-1` for what leaves, `+1` for what arrives) — so a
bonus always comes off by the path it went on. The twenty-one new `OBJNI_*` constants
were computed from the `Objects.h` enum. **Saves:** CSBWin stores the adjusted
attributes, and so does the port (the attributes are saved as they are), so neither a
CSBWin save nor the port's own needs anything on load and `RUNTIME_SAVE_VERSION` is
unchanged. A port save written *before* this commit holds unadjusted attributes: a
champion recruited then with NABI's Staff or BORIS's Rabbit's Foot loses the bonus when
the object comes off, once. Not ported: `SetCursed`, whose only caller is the unported
`STKOP_SetCurse` (G1). Evidence: `tools/checks/item-bonuses.ts` — every row of the table
against the real objects (the names in graphic `0x22c` are the canary, five of them
DM's names for CSB's), the places a row does not apply, curses and the wrapped Luck
minimum, and the four writers (3 of 99 checks fail with the writers stashed, 1 of 100 for
the DSA's).

Found paying C28. `AdjustStatsForItemCarried` (`doc/CSBwin-src/Character.cpp:1574-1775`)
is what makes a carried object change its bearer: a cursed weapon or garment in slots
0-12 costs 3 Luck, a Rabbit's Foot anywhere gives 10; in the weapon hand the Mace of
Order gives 5 Strength and the staffs, wands, Vorpal Blade and their kin give max mana;
Powertowers on the legs 10 Strength; the Crown of Nerra 10 Wisdom and the Dexhelm 10
Dexterity on the head; Flamebain 12 anti-fire and the Cloak of Night 8 Dexterity on the
body; round the neck a Jewel Symal 15 anti-magic, the Cloak of Night 8 Dexterity, the
Moonstone 3 max mana. Maximum, current and minimum all move. CSBWin calls it from
`AddCharacterPossession` (`:1975`), `RemoveCharacterPossession` (`:1863`) and `SetCursed`
(`:1806`, `:1820`). No module of the port has any of it, so none of these objects does
anything worn. Needs the whole table read before porting (`:1605-1765`), a check per
kind of bonus, and a thought about saves: CSBWin stores the adjusted attributes, so a
save loaded from CSBWin already carries the bonuses. Size M.

#### `DEBT.md` tier E — E1 and E2 (paid 2026-09-25 and 2026-09-26)

The tier's open items (E3 and up) are still in `DEBT.md`.

##### E1 ✅ A shared game context, and one set of tables

**What.** `Game`'s constructor (`src/engine/Game.ts:273-590`, about 320 lines) hands the
same five things — the dungeon, a party-state getter, a tick getter, `random`, the timer
queue — to seven subsystems, in three styles:

- positional arguments: `ActuatorSystem`, `DsaSystem`, `TimerSystem`, `MonsterSystem`,
  `MonsterDamage`, `MonsterPerception`, `MonsterAttack`;
- options objects: `MonsterAI`, `CharacterStats`, `AttackSystem`;
- injection after construction — `setTables` (seven classes), `setCharacterStats`,
  `setTeleportPartyHandler`, `monsterDamage.onItem16Freed = …` — needed only because of
  construction order.

The `queueSound` lambda is written out five times, the "activate monster" lambda twice.
Every new call between two systems becomes a new hook in this constructor, which is why
`Game.ts` changed in 36 of the last 77 commits.

The tables are grouped by first consumer, not by content. `TimerTables` has 20 fields and
almost none concern timers: monster descriptors, attack tables, clothing armour,
`byte20090`… `ActuatorTables` carries weights, `weaponDesc` and three *callbacks*
(`onAddCharacter`, `adjustSkillsFilter`, `playSound`). `DsaSystem` receives
`dsaTables ?? actuatorTables`. `main.ts` builds both.

**Fix.** CSBWin's equivalent is the global `d.`. Introduce one context object, created
first, holding the dungeon, the party, the clock, `random`, the timer queue, the sound
queue and a single read-only `GameTables`, and pass it to every subsystem. Callbacks leave
the table types. Before coding, write a short design note into this entry — the shape of
the context, and how cross-system calls (monster ↔ missile ↔ attack) reach each other
without setters — since E2 and E3 build on it.

**Evidence.** Behaviour-neutral: `npm test -- --frames`. The `tools/` construct `Game` too;
they keep working unchanged or are updated in the same commit.

**Design note** (written 2026-09-25, before any code; E2 and E3 build on it).

*The context.* One object, `GameContext` (`src/engine/GameContext.ts`), created first in
`Game`'s constructor and handed to every subsystem as its only constructor argument:

```ts
interface GameContext {
  readonly dungeon: DungeonState;   // the level data, CSBWin's dungeon half of `d.`
  readonly party: Party;            // `ctx.party.state` is always current; no getters
  readonly state: GameState;        // the object `Game.state` is: `state.tickCount` is `d.Time`
  readonly random: Random;
  readonly timers: TimerQueue;
  readonly sounds: SoundQueue;
  readonly tables: GameTables;      // read-only, see below
  readonly host: GameHost;          // what only the host can do: play a sample, trace,
                                    // tell the UI something (null-object by default)
  readonly systems: GameSystems;    // the subsystems themselves, see below
}
```

The `() => this.party.state` and `() => this.state.tickCount` lambdas exist only because
`Party.setState` replaces the state object and the clock is a number. Reading through
`ctx.party.state` and `ctx.state.tickCount` at call time makes them unnecessary.

*Reaching each other without setters.* CSBWin's functions call each other directly. The
port does the same through `ctx.systems`, whose fields (`actuators`, `dsa`, `timer`,
`monsters`, `monsterAI`, `monsterDamage`, `monsterAttack`, `monsterPerception`,
`characterStats`, `attack`, and after E2 the `Game` groups: magic, Hall of Champions,
character actions) are filled one by one as `Game` constructs them. No constructor may
call another system. Only a method may, and methods run after construction, so the
construction order stops mattering. `timer.moveObject` calls
`ctx.systems.monsters.moveMonster(…)`; `monsterAI` calls
`ctx.systems.monsterAttack.monsterAttacks(…)`. That retires `setTables`' callbacks,
`setCharacterStats`, `setTeleportPartyHandler`, `setObjectMover`, `onItem16Freed` and the
hook objects between subsystems (`TimerHooks`' `onDsaTimer*`, `damageMonster`,
`onMonsterAI`…; `MonsterSystemHooks`; `AttackSystem`'s `hooks`). The five `queueSound`
lambdas become `ctx.sounds.queueSound`. A call through the instance also keeps the tools'
interception working: `checks/missile-monster` replaces `monsterDamage.damageMonster` on the
instance, and a direct `ctx.systems.monsterDamage.damageMonster(…)` still finds the
replacement at call time. Only the calls that leave the engine stay callbacks, gathered in
one `GameHost` the host passes to `Game`: `playSound`, `trace`, and the engine→UI notices
(sleep, close the attack menu, repack the open chest, which C34 needs). No per-hook
setters.

*One set of tables.* `GameTables` replaces `ActuatorTables`, `TimerTables`, `DsaTables`
and the `tables:` slices of `MonsterSystem`, `MonsterAttack`, `CharacterStats` and
`AttackSystem`. It is grouped by content under CSBWin's names (`objDesc`, `monsterDesc`,
`weaponDesc`, the weights, the `graphic232` words, the attack tables, the sound table,
`dropOrder`…), and every field is required. One builder, `buildGameTables(graphics)` over
`extractObjectTables` and `extractUITables`, is used by `main.ts` and, through a
`tools/lib/` helper, by the 44 tools that build a `Game`. A tool then gets every table
instead of the subset it chose, so "throws if the table was not handed in" goes away. The
callbacks leave the table types (`onAddCharacter`, `adjustSkillsFilter`, `playSound`
become calls through `ctx.systems` / `ctx.host`), and so does `dsaTables ?? actuatorTables`.
`CHARDESC::Possession(slot)` becomes one free function next to `Champion`, not a context
member, since it needs nothing but the champion.

*Split* (each step behaviour-neutral, `npm test -- --frames` before and after):

| Step | What | Size |
| --- | --- | --- |
| E1a | `GameTables` and `buildGameTables`; `main.ts` and the 44 tools build `Game` through it; subsystems still take their old slices, cut from it | M |
| E1b | `GameContext` without `systems`: every subsystem takes `ctx`; the positional arguments, the options objects and the getter lambdas go | M |
| E1c | `ctx.systems`: the inter-system hooks and the five setters become direct calls | M |
| E1d | `GameHost`: `playSound`, `trace`, the engine→UI notices; the callbacks leave the tables | S |

*Also (found paying D2d):* `CHARDESC::Possession(slot)` is written out once per module —
`Game.getChampionPossession`, `CharacterStats.possession`, `MonsterAttack.possession`,
`AttackSystem`'s hook, `ui/Character.getChampionPossession` — each a one-line
`possessions[slot] ?? OBJECT_ID_NULL`. The context should carry the one reader.

**E1a ✅ (`5afe970`).** `src/engine/GameTables.ts`: one read-only `GameTables`, every
field required, grouped by content (objects, object descriptors, monsters, the dungeon,
the party, attacks and spells, sound). The tables the port had renamed carry CSBWin's
name (`byte1596`, not `roomTimerFunctions`; `byte1386`, `byte10340`, `uByte9672`,
`byte8946`, `sound1772`, `objDescWord4`); a struct array's fields keep the port's names.
`spells` joined it, so `setSpellDefinitions` is gone. `buildGameTables(graphics)` is the
one builder; `main.ts` uses it, and so do the 44 tools, through `tools/lib/game.ts`
(`newGame`, `gameTablesOf`, `stockGraphics`). `Game`'s constructor became
`(dungeonData, tables, options)`, `GameOptions` holding what leaves the engine
(`cursorFilter`, `messages`, `playSound`) and the tools' `timerHooks` / `monsterHooks`.
**No tool depended on a table it had left out**: every tool's full output was diffed
before and after, and the only differences were the five tools that vary from run to run
anyway (recorded as F4), plus the graphics loader's log lines in `checks/viewport-click`,
which now loads graphics. Evidence: `npm test -- --frames`.

**E1b ✅ (`a32d3d6`, `3c9d48f`, `9a49f22`, `eb10975`).** `src/engine/GameContext.ts`:
`GameContext` = `dungeon`, `party`, `state`, `random`, `footprints` (`d.PartyFootprints`,
not in the design note, but shared state that `MonsterPerception` took positionally),
`timers`, `sounds`, `tables`. `createGameContext(dungeonData, tables, playSound)` builds
it, and `Game` takes its members from it. Every subsystem's first argument is `ctx`. The
getter lambdas are gone (`() => this.party.state`, `() => this.state.tickCount`, the party
level, the experience multiplier, `monsterDesc()`), and so are the seven table slices
(`ActuatorTables`, `TimerTables`, `DsaTables`, `MonsterSystemTables`, `MonsterDamageTables`,
`MonsterAttackTables`, `AttackSystemTables`, `CharacterStatsTables`) and their `setTables`.
`d.Word11694` and `d.CurrentPalette` moved into `GameState` (`gameWon`,
`currentPalette`), with `Game` accessors, so the `isGameWon` / `getCurrentPalette` hooks
became reads of `ctx.state`. The `queueSound` hooks became `ctx.sounds.queueSound`, and
`nameIndex` became `nameIndexOf(ctx, rn)`. `ActuatorSystem`'s callbacks left its tables
for an `ActuatorHooks` given at construction, which retired its post-construction
`setTables` call. `SoundQueue` takes `(party, soundTable, play)`. Tools that stand a
subsystem up alone use `newContext(data, graphics, parts)`. Behaviour-neutral: every
deterministic tool's output byte-identical, frames identical, the author's three runtime
saves load and play (no `RUNTIME_SAVE_VERSION` change: `GameState` is not saved as such,
and `RuntimeSaveState`'s `gameWon` goes through the accessor). One tool had to change how
it worked: `checks/missile-door` rewrote `TimerSystem`'s private table bag through a cast,
and now builds its game over a copy of the tables with its own `doorCharacteristics`.

*What E1c inherits.* Still second constructor arguments, for `ctx.systems` to retire:
`DsaSystem(ctx, actuators)`, `TimerSystem(ctx, actuators, hooks)`,
`MonsterAI(ctx, { monsters, damage, perception, … })`,
`AttackSystem(ctx, { monsterDamage, monsterAttack, monsters, dsa, characterStats, hooks })`,
and the hook objects of `TimerSystem`, `MonsterSystem`, `MonsterDamage`, `MonsterAttack`,
`AttackSystem`, `MovementSystem`, `ActuatorSystem`. The setters too: `setCharacterStats`
(`MonsterAttack`, `AttackSystem`), `setTeleportPartyHandler`, `setObjectMover`,
`onItem16Freed`. Many hooks call `Game` methods (`enableCharacterAction`,
`registerChampionBones`, `applyMagicShield`, `addCharacter`…), which have no system of
their own until E2: decide in E1c whether they go through a `ctx.systems.game` for now or
stay hooks until E2 gives them a home. `Game.addCharacterTables` is a two-field slice
still cut from `GameTables` for `assignAddCharacterPossessions`. The `possession` hooks
(the one-line `CHARDESC::Possession`) are still written out per module.

*E1c decision (2026-09-25, before code): the hooks that call `Game` methods.* They go
through `ctx.systems.game`, not through hooks that wait for E2. Its type is
`GameMethods = Pick<Game, …>` (`src/engine/GameContext.ts`): the union names exactly the
`Game` methods a subsystem still calls, each made public for it. That list is E2's
worklist — E2 moves a group into its own system, the subsystems' `ctx.systems.game.x`
become `ctx.systems.<group>.x`, and the names leave the union; E2 is done when
`GameMethods` is gone. The alternative, keeping those hooks until E2, would leave two
mechanisms side by side and every hook written out twice more (declared, then wired in
`Game`'s constructor). A hook whose body adapted its arguments (`magicShield`'s champion
lookup, `applyLight`, `openWindow`, `activateMonster`, `onSpawnMonster`, `hitDoor`'s
clock…) moves into the calling subsystem, at the call site or as a private helper named
after the hook. What leaves the engine (`playSound`, `trace`, `cursorFilter`,
`messages`) stays as it is for E1d.

**E1c ✅ (`450fb25`, `bbbe5a4`, `e522db9`, `aa4e7d0`).** `GameContext.systems`
(`GameSystems`: `actuators`, `dsa`, `timer`, `monsters`, `monsterDamage`,
`monsterPerception`, `monsterAttack`, `monsterAI`, `characterStats`, `attack`, `movement`,
`game`), created empty by `createGameContext` and filled by `Game` at the end of its
constructor. Every subsystem takes `ctx` and nothing else but its E1d host hooks: the
second constructor arguments (`DsaSystem`'s and `TimerSystem`'s `actuators`, `MonsterAI`'s
and `AttackSystem`'s deps objects), the setters (`setCharacterStats` ×2,
`setTeleportPartyHandler`, `setObjectMover`, `onItem16Freed`) and the inter-system hooks of
`TimerSystem`, `MonsterSystem`, `MonsterDamage`, `MonsterAttack`, `MonsterAI`,
`AttackSystem`, `MovementSystem` and `ActuatorSystem` (`onAddCharacter`,
`adjustSkillsFilter`) are gone; `Game`'s constructor went from 233 lines to 49.
`GameMethods` names the 22 `Game` methods a subsystem still calls. Five hooks `Game` never
wired went with their dead branches, each now an explicit default with a pointer here:
`onTriggerMissileLauncher`, `MonsterDamage.monsterDeleteFilter` and
`MonsterAttack.attackFilter` (G2), `stealFromCharacter` (G10). Hook payload fields the real
method ignored (`timer` on the AI calls, the missile's position and direction on
`applyMissileDamageToParty`) went too, and with them `processMissileEncounter`'s unused
`direction`. `AttackSystem` reads `CHARDESC::Possession` itself. Behaviour-neutral: every
tool's full output byte-identical after each commit, but for `checks/save-menu`'s payload
size, which varies by one byte from run to run on its own (3 of 16 runs on an unchanged
tree); frames identical. Two tools that stand a subsystem up alone now fill
`ctx.systems`: `checks/local-action` (a real `DsaSystem`), `checks/monster-damage` (stand-ins
for the timer and actuator systems — its dead group is now lifted through
`MonsterSystem.moveMonster`, as in a `Game`, where the missing hook used to unlink it
bare; the output is unchanged).

*What E1d inherits.* The host hooks, one per subsystem: `TimerHooks.playSound`,
`ActuatorHooks` (`cursorFilter`, `messages`, `playSound`), and the `trace` of
`MonsterSystemHooks`, `MonsterDamageHooks`, `MonsterAiHooks`, `AttackSystemHooks`;
`GameOptions` (`cursorFilter`, `messages`, `playSound`, `monsterHooks`) and `Game`'s own
engine→UI callbacks (`sleepListeners`, `openReincarnateScreen`, the notices C34 needs).
`Game.addCharacterTables` and the per-module `possession` readers are unchanged.

**E1d ✅ (`e2513c2`).** `src/engine/GameHost.ts`: `GameHost` = `playSound`, `trace`,
`cursorFilter`, `messages`, `sleepChanged`, `openReincarnateScreen`, every member
required. `createGameHost(partial)` fills what the host leaves out (or leaves `undefined`,
as `main.ts` does with no audio) with a null object — a cursor filter that lets everything
through, a message sink that drops everything — so no caller asks whether anyone is
listening. It sits at `ctx.host`; `Game`'s constructor is `(dungeonData, tables, host)`,
and `newGame(data, graphics, host)` in `tools/lib/game.ts`. Gone: `GameOptions`,
`ActuatorHooks`, `TimerHooks`, the four `trace` hook types (`MonsterSystemHooks`,
`MonsterDamageHooks`, `MonsterAiHooks`, `AttackSystemHooks`), `ActuatorSystem.getMessages`,
`Game.onSleepChanged` and its listener list, the assignable `Game.openReincarnateScreen`.
`SoundQueue` takes the host. Every subsystem now takes `ctx` and nothing else.
`checks/monster-ai` passes its trace as the host's; `checks/sleep` and `checks/hall-of-champions`
pass `sleepChanged` / `openReincarnateScreen` at construction instead of registering them
after it. Behaviour-neutral: every tool's full output byte-identical, frames identical. The
"notices C34 needs" (close the attack menu, repack the open chest) are not added: C34 adds
them to `GameHost` when it needs them. Still unchanged: `Game.addCharacterTables`, and the
per-module `possession` readers (`MagicSystem` and `CharacterSystem` read
`champion.possessions[slot] ?? OBJECT_ID_NULL` inline rather than add a sixth).

##### E2 ✅ Split `Game.ts` by CSBWin source file

`Game.ts` is 3018 lines (2172 after the first six commits below, 1364 after the next five, 623 at the end). Split it by CSBWin source file, as `src/renderer/ui/` already is
(`doc/UI_MODULE_MAP.md`). Method groups (lines as of 2026-09-23):

| Group | Methods | CSBWin |
| --- | --- | --- |
| Hall of Champions | `addChampion`, `addCharacter`, `resurrectReincarnateCancel`, `finishResurrectReincarnate`, `reincarnateNamed`, `reincarnate`, the mirror helpers, `registerChampionBones` (≈ `:830-1300`) | `AddCharacter` `Character.cpp:457`, `_ResurrectReincarnateCancel` `CSBCode.cpp:6675`, `_ReIncarnate` `Code13ea4.cpp` |
| Periodic updates | `processNinetySecondUpdate`, `processTenSecondUpdate` (≈ `:1407-1590`) | `NinetySecondUpdate` `CSBCode.cpp:7398`, `TenSecondUpdate` `Code17818.cpp:160` |
| Magic | `castMagic`, `fillSpellParameters`, `castSpell`, `incantationToSpell`, … `applyMagicShield` (≈ `:1601-1999`), `characterThrowsSpell` (`:2107`), the spell messages (≈ `:2298-2385`), `castSpellFromUi` | `CastSpell` `Magic.cpp:1092` and its neighbours |
| Cursor drop and throw | `dropObjectFromCursor`, `maybeScheduleViAltar`, `throwObjectFromCursor`, `throwStaminaCost`, `awardThrowSkill` (≈ `:2537-2816`) | `DropObject` `Mouse.cpp:849`, `ThrowByCharacter` `Mouse.cpp:674` |
| Quick-save | `RuntimeSaveState` (≈ `:96-173`), `getRuntimeSaveState`, `applyRuntimeSaveState`, the timer (de)serialisers (≈ `:2813-3073`) | none — the port's own quick-save |
| Character actions | `disableCharacterAction`, `enableCharacterAction`, `setBusyTimerRefill`, `refillPossessionSlot`, `matchingAmmunition`, `removeCharacterPossession` (≈ `:2034-2278`) | find their CSBWin home before moving them |

Leave `Game` as the loop, the construction, and a thin public facade. One group per commit.
Do E1 first.

**Progress (2026-09-25).** The rule applied is the one in the title: a method goes to the
system that ports its CSBWin file, even where the table above grouped it by topic
(`MagicShield` is `Attack.cpp`'s, `DisableCharacterAction` and `AdjustSkills` are
`Magic.cpp`'s). A `Game` method that only adapted a call for one caller moves into that
caller. Each commit behaviour-neutral: every tool's full output byte-identical (but for
`checks/save-menu`'s known one-byte wobble), frames identical.

| Commit | Group | Left `GameMethods` |
| --- | --- | --- |
| `659fcb6` | `MagicSystem` (`src/engine/MagicSystem.ts`, `ctx.systems.magic`, `game.magic`): `CastMagic`, `CastSpell` and its helpers, `SpellErrorMsg`, `StandardSpellMessage`, `CharacterThrowsSpell`, `LaunchObject`, `DisableCharacterAction`, `SetBrightnessTimer`, `AdjustSkills` bound to the context (`applySpellSkillGain`), `queueUtilityTimer`. `Game.castSpellFromUi` is a one-line facade for `main.ts`. | `applySpellSkillGain`, `characterThrowsSpell`, `disableCharacterAction`, `emitSpellMessage`, `launchObject`, `queueUtilityTimer`, `setBrightnessTimer` |
| `1e2fa18` | `Attack.cpp` into `AttackSystem`: `MagicShield` (`applyMagicShield`), and `d.Brightness += delta` inline. `Game.setBrightness`, which nothing called, is gone. | `applyMagicShield`, `adjustBrightness` |
| `1529b4b` | `CharacterSystem` (`src/engine/CharacterSystem.ts`, `ctx.systems.character`, `game.character`): `RemoveCharacterPossession`, `DropAllPossessions`, `setChampionHand` (the stat half of `AddCharacterPossession`), `AdjustStatsForItemCarried` bound to the context, `setPossessionDirect`. This is the one possession home C34 waits for. `setChampionHand` had joined `GameMethods` for one commit, for `MagicSystem`'s Zokathra. | `dropAllPossessions`, `removeCharacterPossession`, `setChampionHand` |
| `7ee7b57` | `KillCharacter`'s tail into `MonsterAttack.killCharacter`: the bones record and the inventory close, at the call sites. | `registerChampionBones`, `onChampionDied` |
| `3abb4b3` | `ProcessMissileEncounter`'s party arm into `TimerSystem` (private `applyMissileDamageToParty`, with `MISSILE_WOUND_MASK`). | `applyMissileDamageToParty` |
| `9b70f20` | The loop's state onto the context (the decision below): `MouseQueue` at `ctx.mouseQueue`, `LoopFlags` at `ctx.loop`, `wakeUp(ctx)` (`LoopState.ts`), `MonsterSystem.loadPartyLevelOnArrival`. `Game.wakeUp` is a facade for `main.ts`. | `wakeUp` |
| `a5c04bd` | `climbDownIntoPit` into `AttackSystem` (private), `handleDsaTeleportParty` into `DsaSystem` (private `teleportParty`, `STKOP_TeleportParty`), `notePartyMoved` into `TimerSystem`. | `climbDownIntoPit`, `handleDsaTeleportParty`, `notePartyMoved` |
| `a72da7f` | `EnableCharacterAction` into `TimerSystem` (private; the `TT_11` case now calls it and `TAG0115ee` apart, as `CSBCode.cpp:6525-6534` does); `matchingAmmunition` (`TAG0153c2`, `Character.cpp:1526` — the old comment said `CSBCode.cpp`) and `refillPossessionSlot` (`TAG0115ee`) into `CharacterSystem`, beside the possession pair C34 rewrites; `setBusyTimerRefill` into its one caller, `AttackSystem`. C36 recorded. | `enableCharacterAction`, `setBusyTimerRefill` |
| `fa6a67e` | `MouseSystem` (`src/engine/MouseSystem.ts`, `ctx.systems.mouse`, `game.mouse`): `DropObject` with its Vi-altar arm, `ThrowObjectInHand`, `throwFromWeaponHand`, `ThrowByCharacter`, `TAG016382`. `awardThrowSkill` went: it was `MagicSystem.applySpellSkillGain(chIdx, 10, …)` line for line. `Game.applyLimits` went for `core/intCast`'s (same result on these clamped ranges). `Game.dropObjectFromCursor` / `throwObjectFromCursor` are facades for `events.ts` and `tools/`. | `throwFromWeaponHand` |
| `6883775` | `HallOfChampions` (`src/engine/HallOfChampions.ts`, `ctx.systems.hallOfChampions`, `game.hallOfChampions`): `AddCharacter`, `_ResurrectReincarnateCancel` and its finish, `ReIncarnate`'s tail, the mirror helpers, `getObjectRecord`, `reincarnationSource`, `addCharacterTables`. One system, not `CharacterSystem`: the three CSBWin files share `reincarnateAttributePenalty` / `reincarnateStatPenalty` (`Character.cpp:14`), and two of them have no other port. `Game.resurrectReincarnateCancel` / `reincarnateNamed` are facades for `main.ts`. `GameMethods` and `ctx.systems.game` are gone. | `addCharacter` — none left |

Every one byte-identical on every tool's full output, frames identical, and the author's
three runtime saves hash the same after load and after 600 ticks as on `bf5c700`.

*What was left at `GameMethods` = 8 names* (kept for the reasoning behind the moves above):

- `addCharacter` (`Character.cpp:457`) — the Hall of Champions group; `AddCharacter` into
  `CharacterSystem`, or one `HallOfChampions` — decided for the second (`6883775`).
- `enableCharacterAction` (`Timer.cpp:2638`) with `refillPossessionSlot` and
  `matchingAmmunition`, and `setBusyTimerRefill` (the port's own helper for the throw's
  `uByte6`).
- `throwFromWeaponHand` — the "Cursor drop and throw" group (`Mouse.cpp`).
- `climbDownIntoPit` (`Attack.cpp:2035`), `handleDsaTeleportParty` (the DSA's party
  teleport), `notePartyMoved` (the footprint step of the world `MoveObject`,
  `Code11f52.cpp:3257`) and `wakeUp` (`CSBCode.cpp:7106`). These four touch `Game`'s
  loop state — `loadPartyLevelIfChanged`, `clockTickSet`, the mouse queue
  (`discardAllInput`) — which `Game` keeps as "the loop".

*Decision: how a system reaches the loop's state (2026-09-25).* In CSBWin all three are
`d.` globals that files other than the main loop write: `WakeUp` sets `d.clockTick = 1`
(`CSBCode.cpp:7109`), an inhibited `MoveParty` clears it (`:8400`), the world `MoveObject`
sets `d.newPartyLevel` (`Code11f52.cpp:3358`), and `DiscardAllInput` (`CSBCode.cpp:7591`)
resets `d.MouseQStart` / `d.MouseQEnd` for whoever calls it. So they move out of `Game`
into the context, as every other `d.` field did in E1 — and **not into `GameState`**:
`SaveGame.cpp` names neither `d.clockTick` nor `d.newPartyLevel`, the port's quick-save
carries none of the three today, and `GameState` is what the quick-save writes, so
putting them there would change the save's shape for state the next tick settles anyway.

- `ctx.mouseQueue` — a `MouseQueue` (`src/engine/MouseQueue.ts`): the ring
  (`pMouseQueue`, `MouseQStart`, `MouseQEnd`, `MOUSEQLEN`), its three writers (a key, a
  click, the button-up), `numEnt`, `DiscardAllInput`, and the head `HandleMouseEvents`
  takes. `HandleMouseEvents` itself stays in `Game`: it is the loop's consumer, and it
  calls `Game.move`.
- `ctx.loop` — a `LoopFlags` (`src/engine/LoopState.ts`): `clockTickSet` /
  `clockTickCleared` (the two ways a caller overrides the VBL's `d.clockTick`) and
  `newPartyLevel` (a level change whose `DiscardAllInput` the next tick owes). `Game`
  reads and clears them in `runFrame` / `gameTick`, as it does now.
- `WakeUp` becomes `wakeUp(ctx)` in the same module: with the flags and the queue on
  the context it needs nothing of `Game`, and its callers are `Monster.cpp:4544`'s and
  `DamageCharacter`'s blow (`MonsterAttack`) and button 146 (`Game.wakeUp`, a facade for
  `main.ts`). `Sleep` (button 145, `Mouse.cpp:1822`) has only the UI calling it and stays.
- The port's early level load (`loadPartyLevelIfChanged`: `LoadPartyLevel` at once, the
  discard owed to the next tick) becomes `MonsterSystem.loadPartyLevelOnArrival()`, beside
  `loadPartyLevel`, setting `ctx.loop.newPartyLevel`. The bare
  `MonsterSystem.loadPartyLevelIfChanged` keeps its other callers, which owe no discard.
  `tag0006a4` (`loadNewPartyLevel`) stays in `Game`: it is the tick.

Then the four go by file: `climbDownIntoPit` into `AttackSystem` (its one caller,
`atk_CLIMBDOWN`), `handleDsaTeleportParty` into `DsaSystem` (`STKOP_TeleportParty`,
`DSA.cpp:4584`, its one caller), `notePartyMoved` into `TimerSystem` beside the world
`MoveObject` it is a step of (E3 will carry it on with the world moves).

*What is left (2026-09-25): `Game` less the loop.* No system calls `Game` any more, so
what remains is found by reading `Game.ts`, not a type. E2 is done when `Game` is the loop
(`runFrame`, `gameTick`, `tag0006a4`, `HandleMouseEvents` and the queue's front door), the
construction, and one-line facades. By group, largest first — confirm each CSBWin home
before moving, and decide the two open questions first:

- **Quick-save** (≈ 340 lines with the `RuntimeSaveState` type): `getRuntimeSaveState`,
  `applyRuntimeSaveState`, `buildTimerRecords`, `restoreTimerQueue`. No CSBWin home — the
  port's own format. A `RuntimeSave.ts` module over the context, which is what E5 (the
  hand-maintained snapshot) then works on. `setPartyState` and `setRandomSeed` go with it
  if they are only its and the tools'.
- **Periodic updates** (≈ 180 lines): `processNinetySecondUpdate` (`NinetySecondUpdate`,
  `CSBCode.cpp:7398`) and `processTenSecondUpdate` (`TenSecondUpdate`,
  `Code17818.cpp:160`). *Open:* `CSBCode.cpp` is the loop's own file, so
  `NinetySecondUpdate` may rightly stay; `TenSecondUpdate` has no system. One small
  module for both, called from `gameTick`, is the likely answer.
- **The attack's engine half**: `championAttack` and `attackStatModifier` (`_ExecuteAttack`,
  `Character.cpp:4969`, which records `attackType` and `word64` around `Attack`), and
  `consumeAttackDamageToDisplay` — `AttackSystem` already owns `attackDamageToDisplay`.
  *Open:* `Character.cpp` says `CharacterSystem`; the body is all `AttackSystem`'s state.
- **The rest of `Mouse.cpp`**: `handleDoorSwitchClick` (the door button), `handleWallClick`,
  `sleep` (button 145, `Mouse.cpp:1822`) — into `MouseSystem`; `sleep` could instead sit
  beside `wakeUp` in `LoopState.ts`.
- **Feeding**: `applyFeeding` (the apply half of `_FeedCharacter`, `Character.cpp:4021`; the code cites `:4365`),
  which only binds `MonsterAttack` and `TimerSystem` calls into `Feeding.ts` — with a
  context those bindings can go into `Feeding.ts` itself.
- **`MoveParty`'s tail**: `move`, `triggerObjectMove`, `setPartyMoveDelay`
  (`MoveParty`, `CSBCode.cpp:8031`; its tail `:8397-8436`). `HandleMouseEvents` calls `move`, so this may be loop; if
  not, `MovementSystem`.
- Small change: `addChampion` (the tools' join; `HallOfChampions` or stays),
  `getChampionPossession`, `getBaseObjectNameIndex`, `nameIndex` (go with their callers).

*Decisions (2026-09-26), taken before the code moved:*

- **The periodic updates** go to one module of two functions over the context,
  `src/engine/PeriodicUpdates.ts` (`ninetySecondUpdate(ctx)`, `tenSecondUpdate(ctx)`),
  as `wakeUp(ctx)` did. `CSBCode.cpp` is the loop's file, but it is also `MoveParty`'s,
  `WakeUp`'s and a hundred other functions'; being in it does not make a function the
  loop. `Code17818.cpp`'s other port, `DetermineMastery`, is `skills.ts`, a table module
  the update should not be folded into. Neither update has state of its own, so no class.
  The cadence tests (`(d.Time & 511) == 0`, `d.Time & (d.PartySleeping ? 15 : 63)`)
  are the loop's (`CSBCode.cpp:690-698`) and move out of the bodies into `gameTick`,
  where CSBWin has them — as two predicates the module exports, `isNinetySecondTick` /
  `isTenSecondTick`, so that the cadence tools test the tick's own test;
  `d.NumCharacter == 0` stays in `TenSecondUpdate` (`Code17818.cpp:174`).
- **`_ExecuteAttack`'s engine half** (`championAttack`, `attackStatModifier`) goes to
  `CharacterSystem` as `executeAttack`, by the file rule: it is `Character.cpp:4969`, it
  writes two `CHARDESC` fields (`word64`, `attackType`) and makes one call into
  `AttackSystem`. `HallOfChampions` was the one exception to the rule, for shared tables;
  there is no such reason here. `consumeAttackDamageToDisplay` goes to `AttackSystem`,
  which owns `d.attackDamageToDisplay`.
- **`MoveParty`'s tail** (`move`, `setPartyMoveDelay`) goes to `MovementSystem`, which
  already ports `MoveParty`'s head (the collision, the stamina): one CSBWin function, one
  home, as `MovementSystem.moveParty`. `HandleMouseEvents` calling it does not make it
  the loop — `Mouse.cpp` calls `CSBCode.cpp` there too. `Game.move` keeps the move
  listeners (`onMove`) and is otherwise a facade.
- **`triggerObjectMove`** (the UI's pick-up from the floor, `ViewportPicking`), with
  `handleDoorSwitchClick` and `handleWallClick`, is `HandleClickInViewport`
  (`Mouse.cpp:1032`: the door switch at `:1064-1090`, `TouchWallF1` at `:1128`, the
  pick-up `TAG01a148` at `:1133`), so all three go to `MouseSystem`. So does `sleep`
  (button 145, `Mouse.cpp:1822`), by the same rule — `WakeUp` is `CSBCode.cpp`'s, which is
  why it sits in `LoopState.ts` and `Sleep` does not join it.
- **The quick-save** becomes `src/engine/RuntimeSave.ts`: `RUNTIME_SAVE_VERSION`, the
  `RuntimeSaveState` type, and `getRuntimeSaveState(ctx)` / `applyRuntimeSaveState(ctx,
  save)` with the timer (de)serialisers. `Game` keeps a facade for each, because loading
  owes one thing to the loop: `HandleMouseEvents`' `lastTime = 0` (`SaveGame.cpp:1785`),
  which is `Game`'s own static. `setPartyState` and `setRandomSeed` stay as facades (the
  map preview and the tools).

**Done (2026-09-26): `Game` less the loop.** Seven commits, each byte-identical on every
tool's full output (but for `checks/save-menu`'s one-byte wobble), frames identical, and
the author's five runtime saves hash the same after load and after 600 ticks as on
`b143003`. `RUNTIME_SAVE_VERSION` stays 10: the payload's shape did not change.

| Commit | Moved |
| --- | --- |
| `fd2f69a` | The quick-save into `src/engine/RuntimeSave.ts`: `RUNTIME_SAVE_VERSION`, `RuntimeSaveState`, `getRuntimeSaveState(ctx)` / `applyRuntimeSaveState(ctx, save)`, the timer (de)serialisers. `Game` keeps the two facades, the second also resetting `HandleMouseEvents`' `lastTime`. |
| `e968d68` | `NinetySecondUpdate` / `TenSecondUpdate` into `src/engine/PeriodicUpdates.ts`; the cadence tests out of the bodies into `gameTick`, as `isNinetySecondTick` / `isTenSecondTick`, which the three cadence tools now call too. |
| `214e6b5` | `_ExecuteAttack`'s engine half into `CharacterSystem.executeAttack`; `consumeAttackDamageToDisplay` into `AttackSystem`. `Game.tables` went with the last reader. |
| `ff0899a` | `HandleClickInViewport`'s engine arms — `handleDoorSwitchClick`, `handleWallClick`, `triggerObjectMove` (the floor pick-up's `MoveObject`) — and `sleep` into `MouseSystem`. C37 recorded on the way. |
| `5b1607c` | `applyFeeding`'s bindings into `Feeding.applyFeedParameters(ctx, …)`; `FeedingHooks` is gone. |
| `2606967` | `MoveParty`'s tail into `MovementSystem.moveParty`, with `setPartyMoveDelay`. `Game.move` keeps the `onMove` listeners. |
| `7749f9d` | `addChampion` (the tools' join) into `HallOfChampions`. |

What `Game` is now: the loop (`start`/`stop`/`gameLoop`, `runFrame`, `gameTick`,
`loadNewPartyLevel` = `tag0006a4`, `handleMouseEvents` with `lastInputTime`, the mouse
queue's front door), the construction, the `onTick` / `onMove` listeners, and one-line
facades. Not moved, knowingly: `setPartyState` (two lines, the map preview's) and the
`getPositionInfo` / `getTickCount` / `getElapsedTime` debug getters.

#### `DEBT.md` tier F — F4 (paid 2026-09-25)

##### F4 ✅ Four suite tools draw from an unseeded stream

**Paid in `dccb6a9`.** `checks/monster-ai`, `checks/throwing` and `checks/watch-monsters` call
`game.setRandomSeed(0x12345678)`; `checks/attributes` built no `Game` at all — its `levelUp`
calls fell back to a fresh unseeded `CsbRandom` each — and now shares one seeded stream.
Each gives the same output on every run, and each still exercises what it asserts
(`checks/attributes` sees six raises, 45 checks; `checks/watch-monsters` 16 groups move).
`checks/save-menu` still varies, by the save date. Found on the way, and left: `levelUp`'s
`random` is optional and falls back to an unseeded stream, the F1 shape.


*(Found paying E1a, 2026-09-25, by diffing every tool's output before and after.)*
`checks/attributes`, `checks/monster-ai`, `checks/throwing` (its `Game`; its `CharacterStats`
is seeded) and `checks/watch-monsters` build a `Game` without `setRandomSeed`, so their output
changes from run to run: `checks/attributes` even runs 47, 49 or 51 checks. They pass
because their assertions hold for any seed, but a run cannot be compared with the last one,
which is what a refactor needs. (`checks/save-menu` varies too, by a byte of payload size;
that is the save date, not the random stream.) Fix: seed each, as the skill says
(`game.setRandomSeed(0x12345678)`), then check the assertions still bite.
