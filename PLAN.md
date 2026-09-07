# dmweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

## Ground rules

1. **The build must stay clean.** `npm run build` runs `tsc && vite build`; `tsc --noEmit`
   must pass with zero errors before any commit. Note that `vite build` alone will happily
   succeed on broken code — esbuild strips types without checking them — so `tsc` is the
   only real gate. (The project sat with a broken `tsc` and a genuine runtime bug hidden
   among the type errors; don't let that recur.)
2. **No guessed tables in the shipping path.** If a rectangle/offset/formula is not extracted
   from the game data or transcribed from CSBWin, mark it as temporary.
3. **One renderer is authoritative**: the bytecode-based path.
4. Prefer small tooling over manual reasoning: table dumps, render probes, trace hooks.

## Status (September 2026)

Verified against the code, not inherited from earlier revisions of this file.

**Solid:**
- Data loading: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, save games (base + extended).
- Bytecode viewport renderer — the authoritative path. All `0x22e` rectangle tables are
  extracted at runtime; no guessed geometry remains in the renderer.
- Movement + collision, CSBWin-style 3-deep key queue, immediate post-move timer processing.
- Timer queue with CSBWin duplicate-timer suppression.
- Actuators, DSA scripting, teleporters, pits, doors, false walls.
- Missiles and throwing (lifecycle, encounters, DSA filters).
- Skills/experience (mastery, AdjustSkills, LevelUp), magic casting (all three spell classes).
- Light levels / palette switching, sound, most of the DM UI.

**Known-incomplete, in rough priority order:**
1. ✅ **Message area** — done (Phase 11). CSBWin's `SCROLLING_TEXT` is ported: fragment-based
   emission, 53-column word wrap, 4 rows with 70-tick expiry, and `updateDebug()` demoted to
   the external debug log. Scroll *animation* and save-game serialization remain deferred.
2. **No monsters.** *This is the current priority.* `Monster.cpp` is entirely unported: no AI, no movement, no attacks, no
   creature generators. Several systems carry proxies waiting on it (see Phase 12).
3. **No champion death / bones / resurrection**, no character creation, no potion drinking.
4. **Clouds are created but inert** — no timer, no damage, never expire (Phase 9 step 13).
5. **Throw stats are estimates**, not CSBWin's skill/weight/stamina formulas (Phase 9 step 11).
6. ✅ **Debug scaffolding** — done (Phase 14). Now confined to `src/dev.ts` and reached only
   through `isDebugFeaturesEnabled()`.
7. ✅ **`ViewportRenderer.ts` god object** — done (Phase 14). Split from 3809 lines to 723;
   the UI now lives in `src/renderer/ui/`.
8. **CSBWin-binary-compatible save files** not attempted (Phase 10).

**Validation debt:** several phases below list "Validation" steps (render tests, render
probes, pixel comparisons against CSBWin screenshots) that were **never carried out** —
there is no test framework in the project at all. Verification has been visual and ad hoc.
Those items are now marked 🚫 where they were silently skipped; Phase 15 addresses this.

There is now one partial exception: `tools/probe-frames.mjs` + `tools/check-frames.sh`
drive the real app over the DevTools Protocol and byte-compare five screen states against
`tools/frames/`. It was built to make the Phase 14 split safe and it is *not* a test
framework — five frames, no assertions beyond equality, and it needs a dev server and a
headless Chrome running. Phase 15 should absorb it rather than start from nothing.

## Next Steps (Phased)

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

### Phase 10 — CSBWin-Compatible Save/Load (pre‑work checklist)
Goal: ensure internal state and data structures are complete enough to write a binary‑compatible CSBWin save file.

1. **Inventory all save file blocks (CSBWin `SaveGame.cpp`)**:
   - Block1 (512 bytes), Block2 (128 bytes), Item16, Characters, Timers, TimerQueue.
   - Extended features: DSA blocks, extended wall decorations, sequenced/extended timers.
2. **Define missing runtime state in TS**:
   - Global engine state: random seeds, time counters, movement counts, party level/position/facing, UI state flags, object-in-hand, etc.
   - Timer queue metadata and ordering state (not just Timer table contents).
3. **Mirror CSBWin database record layouts**:
   - All DB records (door/teleporter/text/actuator/creature/weapon/clothing/scroll/potion/container/misc/missile/cloud) with correct bitfields, padding, and word sizes.
   - Include any save‑only fields (Item16 runtime indices, missile/cloud records) not present in base dungeon.dat.
4. **Add full object list serialization**:
   - `objectList`, `columnIndex`, `levelIndex`, and per‑cell object chains must be written/read exactly as CSBWin.
   - Ensure object positions (RN pos bits) and link fields are preserved.
5. **Persist cell flags and dynamic room state**:
   - Door/pit/falsewall/teleporter flags in `cellFlags` must be saved (not inferred from dungeon.dat).
6. **Character/party blocks**:
   - Implement CSBWin character block layout (3328 bytes) with exact packing of inventory, stats, skills, spells, wounds, and flags.
7. **Text/indirect text indices**:
   - Ensure `textWords`, `indirectTextIndex`, and any converted text tables are serialized when required by CSBWin.
8. **Extended features**:
   - DSA level index tables and DSA state blocks (if `CSBgraphics.dat`/extended flags present).
   - Extended wall decorations and related flags in save file header.
9. **Checksum/scramble parity**:
   - Implement CSBWin block checksums and scramble/unscramble exactly (endianness + word ordering).
10. **Round‑trip validation tooling**:
   - Add a tool to load CSBWin save → re‑serialize → binary‑compare.
   - Add targeted checks for door/pit state, object chains, and timers after load.

Status: ⏳ pending — not started. Note this is a large piece of work and is *not* a
prerequisite for playability; quick-save/load via a runtime JSON snapshot already works.

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

### Phase 12 — Monsters: AI, movement, combat

Goal: port `doc/CSBwin-src/Monster.cpp` and the attack pipeline in
`doc/CSBwin-src/Attack.cpp`. This is the single largest remaining gap — there are currently
**no active monsters at all**, only their rendering.

Several systems already carry proxies waiting on this phase; each must be revisited here:
- `LastMonsterAttackTime` is fed from the missile-hit path instead of real monster attacks
  (gates `AdjustSkills` scaling).
- Monster attack rendering is triggered from the renderer rather than from combat logic.
- Monster teleport rotation/position logic and monster teleporter sounds are stubs.
- `Game.registerChampionBones()` exists but is never called automatically.
- Attack panel (Phase 7 item 14) cannot show real actions without `PossibleAttackTypes`.

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
   - ⏳ Still to do: `ProcessTimers29to41` itself (a marked placeholder that logs and
     returns), and the `MoveObject` integration so monsters use the same
     teleporter/stairs/pit paths as the party.

   Verified with `tools/dump-monster-activation.ts` (new): on level 3 the real
   dungeon activates 13 groups — worms in the corridor at (2,1)-(6,1), munchers,
   rock piles, a Rive — each with exactly one AI timer whose `uByte5` is
   `255 - movementTicks06` for its type, and every DB4 pointing back at its own slot.
   All five `tools/check-frames.sh` frames unchanged.
3. **AI / targeting.** Port monster activation, pursuit, fleeing, and attack selection.
4. **Attack resolution.** Port `Attack.cpp`: hit determination, damage, wounds, armour,
   `PossibleAttackTypes`, and champion↔monster hooks into `AdjustSkills`.
5. **Creature generators.** Port actuator type 6 generator behaviour and
   `TT_REACTIVATE_GENERATOR` (the timer type is already defined).
6. **Retire the proxies** listed above and delete the renderer-side attack trigger.

**Scope decided at the start of the phase.** Items 1-4 (with champion death/bones, since
item 6 requires retiring the `registerChampionBones` proxy) are being done first; items 5
and 6, and the champion melee pipeline from `Attack.cpp` with the real attack panel
(Phase 7 item 14), follow. `Attack.cpp`'s Lord Chaos endgame — `_Fusion`,
`_FusionSequence`, `FluxCage`, `IsLordChaosHere` — is **deliberately deferred**: it cannot
be exercised until both monsters and Lord Chaos work, so porting it now would land
untested. Validation is `tools/check-frames.sh` plus a dev-only AI trace mirroring
CSBWin's own `AITraceActive` output (`Monster.cpp:3290`), so the two codebases stay
diffable; a real test framework stays Phase 15.

Status: 🔄 in progress — step 1 done, step 2 partly done.

### Phase 13 — Champion lifecycle

1. ⏳ **Death.** Champion death → bones creation → possessions dropped to the floor. Wire
   `Game.registerChampionBones()` into this path so the bones↔champion mapping is automatic.
2. ⏳ **Item naming.** Add the bones-name special case once the champion-bones value from
   DB10 is exposed.
3. ⏳ **Resurrection / reincarnation** at the altars, including the reduced-HP rule.
4. ⏳ **Character creation.** Portrait selection and the hall-of-champions flow.
   `HeroExtractor` + `AddCharacter` already provide preset heroes; this replaces the debug
   random-party injection.
5. ⏳ **Drinking potions.**
6. ⏳ **Pit fall damage** + stamina drain, for party and monsters.
7. ⏳ **Red square around the eye on level gain.**

Status: ⏳ not started.

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
   does not exist yet; only `addCharacterFromPortrait` does) and F5/F9 are the only way to
   persist anything (Phase 10). Delete each one as its real feature lands.
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

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ⏳ Add a minimal test runner (the repo has no `test` script at all).
2. ⚠️ **Golden-frame rendering tests.** Partly there: `tools/probe-frames.mjs` drives the
   real app over the DevTools Protocol and `tools/check-frames.sh` byte-compares five states
   against `tools/frames/`. Determinism comes from clearing localStorage and seeding
   `Math.random` on every load. What it still needs to become a real test: a fixed set of
   *party positions* rather than whatever the boot dungeon gives, rendering straight from the
   index buffer instead of a browser screenshot (no dev server, no Chrome), and a `test`
   script that runs it. Absorb it rather than starting over.
3. ⏳ **Render probe tool** (Phase 5's skipped validation): render a single cell program with
   controlled inputs and dump the viewport as PNG.
4. ⏳ **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately.
5. ⏳ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation).

Status: ⏳ not started.
