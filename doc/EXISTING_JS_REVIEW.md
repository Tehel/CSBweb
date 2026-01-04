# Existing JavaScript Implementation Review

Review of the proof-of-concept JavaScript code in `static/js/` directory.

**Date**: 2026-01-04
**Total Lines**: 4,358 LOC across 9 files

---

## File Overview

| File | Lines | Status | Purpose |
|------|-------|--------|---------|
| **dungeon.js** | 1,351 | 🟡 Partial | Dungeon.dat parser - header & levels only |
| **graphics.js** | 1,071 | 🟢 Complete | Graphics.dat parser & decoder (IMG1/IMG2) |
| **pack.js** | 219 | 🟢 Complete | Compression (LZW, RLE, SND) |
| **file.js** | 87 | 🟢 Complete | Binary file reader utility |
| **mediaindex.js** | 575 | 🟢 Complete | Graphics & sound indices |
| **menu.js** | 348 | 🟡 Partial | Menu UI zone |
| **main.js** | 169 | 🟡 Partial | App entry & zone runner |
| **keys.js** | 244 | 🟢 Complete | Keyboard input handling |
| **toolbox.js** | 294 | 🟢 Complete | Utility functions |

**Legend**: 🟢 Complete and reusable | 🟡 Partial/needs work | 🔴 Not started

---

## Detailed Analysis

### 1. file.js (87 lines) - 🟢 Reusable

**Class**: `RemoteBinaryFile`

**Features**:
- Fetch binary files via HTTP (using a `server` helper)
- Read 8/16/32-bit integers (big-endian)
- Seek/skip operations
- Subarray extraction

**Implementation Quality**: Clean and well-structured.

**Port Strategy**: ✅ Direct port to TypeScript
- Use `fetch()` API instead of `server.get()`
- Add TypeScript types
- Keep same interface

**Estimated Effort**: 1 hour

---

### 2. pack.js (219 lines) - 🟢 Reusable

**Functions**:
- `LZWexpand()`: LZW decompression (used in graphics.dat)
- `RLEexpand()`: RLE decompression (used in graphics.dat)
- `SNDexpand()`: Sound decompression (nibble-based RLE)

**Implementation Quality**: Well-tested, works correctly.

**Port Strategy**: ✅ Direct port to TypeScript
- Pure functions, no dependencies
- Add type annotations
- Consider using `Uint8Array` throughout

**Estimated Effort**: 2 hours

---

### 3. graphics.js (1,071 lines) - 🟢 Mostly Reusable

**Class**: `Screen`

**Features Implemented**:
- ✅ Load graphics.dat file
- ✅ Parse header (item count, compressed/decompressed sizes)
- ✅ Extract and decompress graphics (LZW + RLE)
- ✅ IMG1/IMG2 format decoder (RLE nibbles)
- ✅ Palette extraction (8 palettes × 16 colors)
- ✅ Portrait extraction (champion faces)
- ✅ Item extraction (objects, weapons, etc.)
- ✅ Font extraction
- ✅ Sound extraction and playback (Web Audio API)
- ✅ Image caching system
- ✅ Canvas rendering utilities

**IMG1/IMG2 Decoder** (lines 187-280):
Fully implements the RLE nibble algorithm from documentation:
- 0x0-0x7: Repeat color (1-8 times)
- 0x8: Extended repeat (read byte)
- 0x9: Raw pixel data
- 0xA: Transparent pixels
- 0xB: Copy from previous line
- 0xC: Extended repeat (read word)
- 0xE: Extended transparent
- 0xF: Copy from previous line (extended)

**Implementation Quality**: Complex but functional. Some hardcoded indices.

**Port Strategy**: 🔄 Port with refactoring
- Extract IMG1/IMG2 decoder into separate pure function
- Separate data loading from rendering
- Remove `Screen` god class, split into:
  - `GraphicsLoader` (file loading)
  - `GraphicsDecoder` (IMG1/IMG2 decoding)
  - `GraphicsCache` (caching)
  - `Renderer` (canvas operations)
- Keep palette system as-is
- Port sound extraction but separate from graphics

**Estimated Effort**: 6-8 hours

---

### 4. dungeon.js (1,351 lines) - 🟡 Partially Complete

**Class**: `Dungeon`

**Features Implemented** (lines 1-125):
- ✅ Parse header (44 bytes):
  - Seed, map count, text size
  - Starting position (x, y, level, facing)
  - Object counts (16 categories)
- ✅ Parse map descriptors (16 bytes × map count):
  - Width, height, level number
  - Graphics counts
  - Difficulty, door types
- ✅ Calculate all database offsets
- ✅ Read some creature data
- ✅ Read some door data

**Features NOT Implemented**:
- ❌ Parse column index
- ❌ Parse object ID list
- ❌ Parse text data (5-bit encoding)
- ❌ Parse most databases (only partial creature/door)
- ❌ Parse map data (tile definitions)
- ❌ Build 3D cell flags array
- ❌ Object linking system
- ❌ Text decompression
- ❌ Champion definitions

**Code Quality**: Started well, then incomplete. Has TODOs and commented sections.

**Incomplete Example** (line 101-125):
```javascript
// TODO: read map data
// this.maps[i].data = ...

// lots of reading offset calculations but not actual parsing
```

**Port Strategy**: 🔄 Complete implementation in TypeScript
- Reuse header parsing logic
- Reuse map descriptor parsing
- **Implement missing features**:
  - Column index parsing
  - Object list parsing
  - Text data decoder (5-bit → ASCII)
  - All 16 database parsers
  - Map tile data parser
  - 3D array builder for cell access
- Use documentation from `DUNGEON_DAT_FORMAT.md`

**Estimated Effort**: 12-16 hours (significant new code needed)

---

### 5. mediaindex.js (575 lines) - 🟢 Reusable

**Purpose**: Hardcoded indices for graphics and sounds

**Content**:
- `imagesIndex`: Maps image numbers to names (563 entries)
- `soundsIndex`: Maps sound numbers to names (79 entries)

**Examples**:
```javascript
imagesIndex = {
    0: "credit",
    1: "title",
    2: "title background",
    // ... 560 more
}

soundsIndex = {
    0: "walk",
    1: "open door",
    // ... 77 more
}
```

**Port Strategy**: ✅ Convert to TypeScript constants
- Create enums or const objects
- Type-safe access

**Estimated Effort**: 30 minutes

---

### 6. main.js (169 lines) - 🟡 Reference Only

**Structure**:
```javascript
let screen = null;
let dungeon = null;
let keys = null;
let zonerunner = null;

async function start() {
    keys = new Keys();
    screen = new Screen(canvas.getContext("2d"), 2);
    await screen.init();
    dungeon = new Dungeon();
    await dungeon.init();

    zonerunner = new ZoneRunner();
    zonerunner.load('menu', new ZoneMenu());
    zonerunner.load('game', new ZoneGame());
    zonerunner.select('menu');
}
```

**ZoneRunner Concept**:
- Different "zones" (menu, game, etc.)
- Each zone has `onActivate()`, `onDeactivate()`, `onRefresh()`
- Tick-based event loop (100ms intervals)

**Port Strategy**: 🔄 Redesign for TypeScript
- Keep zone pattern but modernize
- Use proper dependency injection
- State management system
- Game loop with `requestAnimationFrame()`

**Estimated Effort**: 4-6 hours

---

### 7. menu.js (348 lines) - 🟡 Reference Only

**Class**: `ZoneMenu`

**Features**:
- Display title screen
- Play intro music
- Show credits
- Simple menu navigation (keyboard)

**Port Strategy**: 🆕 Rewrite for MVP
- Menu not critical for MVP
- Start directly in game for testing
- Add menu later

**Estimated Effort**: Defer to post-MVP

---

### 8. keys.js (244 lines) - 🟢 Mostly Reusable

**Class**: `Keys`

**Features**:
- Key mapping (physical keys → game actions)
- Repeat delay/rate for held keys
- Queue system for inputs
- Special handling for arrow keys

**Implementation**: Well-structured, event-driven.

**Port Strategy**: ✅ Port with minor updates
- Convert to TypeScript
- Use modern `KeyboardEvent.code` instead of `keyCode`
- Integrate with game loop

**Estimated Effort**: 2-3 hours

---

### 9. toolbox.js (294 lines) - 🟢 Partially Reusable

**Functions**:
- `Server` class: XMLHttpRequest wrapper
- `setPixel()`, `getPixel()`: Canvas pixel ops
- `rgb()`: RGB helper
- `bit()`: Bit testing
- `displayBinary()`: Debug helper

**Port Strategy**: 🔄 Selective port
- ✅ Port bit manipulation helpers
- ❌ Skip `Server` class (use `fetch()`)
- ✅ Port pixel helpers if needed

**Estimated Effort**: 1 hour

---

## What's Missing for MVP

Based on the existing code, here's what still needs to be implemented:

### Critical (Must Have)

1. **Complete dungeon.dat parser** (12-16 hours)
   - Object list parsing
   - Text data decoder
   - All database record parsers
   - Map tile data parser
   - Cell flags array builder

2. **Game state management** (4-6 hours)
   - Party position, facing, level
   - Champion data structures
   - Current level/map state

3. **Movement system** (6-8 hours)
   - Collision detection
   - Cell type handling
   - Party repositioning
   - Stamina costs

4. **First-person renderer** (12-16 hours)
   - Wall rendering (distance-based)
   - Floor/ceiling rendering
   - Texture mapping
   - Viewport projection

5. **Game loop** (4-6 hours)
   - Tick-based timing
   - Input → Update → Render cycle
   - State management

**Total MVP Effort**: 38-52 hours

### Already Done (Reusable)

- ✅ Binary file reader
- ✅ Compression algorithms
- ✅ Graphics.dat parser
- ✅ IMG1/IMG2 decoder
- ✅ Palette system
- ✅ Sound extraction
- ✅ Keyboard input
- ✅ Basic utilities

**Reusable Effort Saved**: ~20 hours

---

## Port Priority

### Phase 1: Foundation (8-10 hours)
1. ✅ Port `file.js` → `BinaryFile.ts`
2. ✅ Port `pack.js` → `compression.ts`
3. ✅ Port IMG1/IMG2 decoder → `imageDecoder.ts`
4. ✅ Port palette system → `palette.ts`

### Phase 2: Data Layer (16-20 hours)
5. 🔄 Port & complete `dungeon.js` → `DungeonLoader.ts`
6. 🔄 Port `graphics.js` → `GraphicsLoader.ts`
7. ✅ Port `mediaindex.js` → `constants.ts`

### Phase 3: Game Engine (16-20 hours)
8. 🆕 Implement `GameState.ts` (party, champions, level)
9. 🆕 Implement `MovementSystem.ts` (collision, positioning)
10. 🆕 Implement `GameLoop.ts` (timing, updates)

### Phase 4: Rendering (12-16 hours)
11. 🆕 Implement `Viewport.ts` (first-person view)
12. 🆕 Implement `WallRenderer.ts` (3D projection)
13. 🆕 Implement `FloorRenderer.ts` (perspective)

### Phase 5: Integration (8-10 hours)
14. 🔄 Port `keys.js` → `InputManager.ts`
15. 🆕 Wire everything together
16. 🆕 Testing and debugging

**Total Estimated Effort**: 60-76 hours

---

## Recommendations

### What to Reuse

**High Priority**:
1. ✅ Binary file reader (`file.js`) - works great
2. ✅ Compression algorithms (`pack.js`) - tested and correct
3. ✅ IMG1/IMG2 decoder (`graphics.js`) - fully working
4. ✅ Graphics loading (`graphics.js`) - solid foundation
5. ✅ Keyboard input (`keys.js`) - well-designed

**Medium Priority**:
6. 🔄 Dungeon header parsing (`dungeon.js`) - good start
7. 🔄 Palette system (`graphics.js`) - works but needs cleanup
8. 🔄 Utility functions (`toolbox.js`) - selective port

### What to Rewrite

**Needs Completion**:
1. 🔄 Dungeon parser - 80% missing functionality
2. 🔄 Main structure - modernize architecture

**Not Started**:
3. 🆕 Game engine (movement, collision, state)
4. 🆕 Rendering (viewport, walls, floor)
5. 🆕 Game loop

### Architecture Changes

**Current JS Architecture** (Proof of Concept):
```
Global instances → Classes → Direct DOM access
```

**Proposed TypeScript Architecture** (Clean):
```
src/
├── core/           # Types, constants, utilities
├── data/           # Loaders (dungeon, graphics)
├── engine/         # Game logic (state, movement)
├── renderer/       # Viewport rendering
└── ui/             # Input, canvas management
```

**Benefits**:
- Type safety
- Clear dependencies
- Testable modules
- Separation of concerns
- No global state

---

## Conclusion

**Existing Code Value**: 📊 40% of MVP is reusable

**What's Done**:
- ✅ File I/O and compression
- ✅ Graphics decoding
- ✅ Basic input handling

**What's Missing**:
- ❌ Complete dungeon parser
- ❌ Game engine
- ❌ Rendering system

**Recommended Approach**:
1. Port working code (file, pack, graphics decoder)
2. Complete dungeon parser using documentation
3. Build game engine from scratch (using CSBWin as reference)
4. Build renderer from scratch (using CSBWin viewport code)

**Timeline**: 8-10 weeks for playable MVP (working evenings/weekends)
