---
name: screen-regions
description: CSBWin's in-play screen is five regions placed by its code (not its tables), with black gaps at x 224-232 and 274-280 that Conflux draws a flame in; where the facts and the code are
metadata:
  type: project
---

The adventure screen is five regions, placed by CSBWin's code:

- top band, rows 0-32: portraits x 0-273 | gap 274-280 | top view of positions 281-319;
- middle band, rows 33-168: viewport x 0-223 | gap 224-232 | right-hand column 233-319;
- messages, rows 169-199, full width.

The gaps are not empty by definition: they belong to areas drawn from the region's first
column. Graphic 13 (the movement arrows) is blitted into `d.Word28`, x 224-319, and
Conflux's version holds a white flame in x 224-232, rows 141-168 (golden frame 18). The
formation's left squares' hit areas also reach into the top gap from x 274.

Citations are in `doc/PROVEN_FACTS.md` → "The screen's five regions, as CSBWin's code
places them". `src/renderer/LeftHanded.ts` moves the regions and gaps for the
left-handed screen; `playRects` there lists which `graphics.dat` rectangles are
screen-coordinate, in-play ones (the rest are menus, region fills, or viewport-relative).

**Why:** finding the seams, and learning that a "black" gap can hold a data set's
pixels, took a survey of every data set's tables and every golden frame.

**How to apply:** any layout work on the in-play screen (moving, mirroring, overlaying
panels): start from these regions, and check a gap's pixels in a custom set's frames
before treating it as black.
