# dmweb – Implementation Plan (Renderer Compliance First)

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

## Status (Current)

- Renderer choice: ✅ **Bytecode-based renderer only** (authoritative path)
- Phase 1: ✅ all `graphics.dat` `0x22e` rectangle tables wired

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
- Add a minimal render test that blits a known wall bitmap into `F0L1` / `F0R1` using extracted rectangles and verifies pixels change where expected.

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
- Render known positions in `static/gamefiles/dungeon.dat` and compare against expected “qualitative” outcomes (wall vs open vs door etc.) before pixel-perfect checks.

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
- Add a small “render probe” tool that renders a single cell program with controlled inputs and dumps the viewport as PNG.

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
- ✅ Extended wall/floor decorations now load from `CSBgraphics.dat` and render via ReadWallDecoration/ReadFloorDecoration semantics (`doc/CSBwin-src/Graphics.cpp:3201+`, `doc/CSBwin-src/CSBCode.cpp:3073-3807`) (`src/data/CSBGraphicsLoader.ts`, `src/renderer/bytecode/BytecodeInterpreter.ts`, `src/main.ts`).
- ✅ Teleporter draw opcode now renders using `graphics.dat` `0x22e` teleporter descriptors (`DrawTeleporter`, `doc/CSBwin-src/CSBCode.cpp:4266`), with a CSBWin-style `TAG008c98` chunky port for mask/overlay blits.
- ✅ `DrawRoomObjects` now handles monsters/missiles/clouds in addition to items, using CSBWin tables from `graphics.dat` `0x22e/0x22f` (`Word7042/7162/7222/7246`, `Byte5752/5758/5696`, `struct5688`, `Item6414`, `MonsterDescriptor`) and object list traversal (`doc/CSBwin-src/Code51a4.cpp:2618+`).
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

Status:
- ✅ Step 1: current `dungeon.dat` has no custom backgrounds; still implementing support for compatibility.
- ⏳ Step 2: implement `BACKGROUND_LIB`/`skinCache` selection and custom code execution path.

### Phase 7 — UI Rendering (faithful DM layout)
Goal: render the original Dungeon Master UI (portraits, status bars, hands, controls, and message area) with CSBWin-accurate layout and graphics.

1. **Inventory CSBWin UI entrypoints and tables**:
   - Identify authoritative draw paths in `doc/CSBwin-src/Character.cpp`, `Menu.cpp`, and `CSBCode.cpp` (UI rectangles, panel bitmaps, font usage).
   - Record exact source graphics indices and rectangle coordinates used for the UI (avoid guessed positions).
2. **Introduce a screen-level draw pipeline**:
   - Add a screen buffer for the full 320×200 frame and render the viewport into it before UI draws.
   - Port CSBWin blit semantics for UI elements (same `TAG0088b2` behavior and transparency).
3. **Draw static UI frame**:
   - Render borders, panel backgrounds, and static widgets exactly as CSBWin does (source graphics and placement).
4. **Draw dynamic party state**:
   - Champion portraits + name/health/stamina/mana bars.
   - Hand slots, active/inactive champion selection, and status icons.
5. **Message area + text**:
   - Render the message line(s) and overlay text using the CSBWin font graphic and decoding rules.
6. **Input hit‑tests (visual only at first)**:
   - Map mouse/keyboard regions to UI elements for future interaction; draw selection highlights where applicable.

Validation
- Compare against CSBWin screenshots for at least 3 known scenes (start, mid‑dungeon, combat UI).
- Verify pixel‑perfect alignment of the viewport frame, portraits, and message line.

## Practical Guidance for Work Organization

- **One renderer is authoritative**: keep bytecode-based as the shipping path.
- **No guessed tables in the final path**: if a rectangle/offset is not extracted from the CSBWin-loaded tables, treat it as temporary/debug-only.
- Prefer small tooling over manual reasoning:
  - “Dump tables” from `graphics.dat`
  - “Render probe” for one opcode/program
  - Regression snapshot images for a handful of known party positions
