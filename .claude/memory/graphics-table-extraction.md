---
name: graphics-table-extraction
description: graphics.dat table offsets are already solved — the skips in parseGraphic230/232 and the ABS_* constants in ObjectTables mark where each unextracted table lives
metadata:
  type: project
---

Extracting a new table from `graphics.dat` is usually **mechanical, not research**,
because the surrounding offsets are already proven.

- **Graphic `0x230`** (`parseGraphic230` in `src/data/tables/UITables.ts`) and
  **`0x232`** step through the blob with an explicit cursor; tables not yet needed are
  skipped with arithmetic like `off += 44 * 7`. Those skips *are* the offsets — replace
  the skip with a read.
- **Graphic `0x22f`** (`src/data/tables/ObjectTables.ts`) uses absolute addresses
  from `doc/CSBwin-src/Data.h` subtracted from `ABS_22F_START` (10340). Higher declared
  address = earlier in the blob. Add an `ABS_*` constant from the `Data.h` comment and
  the read follows.

Six-word records like `MONSTERDESC` are big-endian; the `fixItem26`-style helpers in
`CSBCode.cpp` list exactly which fields are swapped.

**Why:** it looks like reverse engineering and is not; a dozen tables have gone in this way.

**How to apply:** find the field in `Data.h`, locate the matching skip or `ABS_*`
neighbour, replace it with a read, then add the new table's region to
`tools/dump-graphics-tables.ts`, which writes it back over the item at its `Data.h`
offset (items `0x22e` so far; `PLAN.md` Phase 15 step 4 has the rest). A canary in a
`tools/` dump still proves what the bytes *mean* (the `verification-tools` skill).
