---
name: text-records-three-readers
description: A TEXT record is drawn by the wall font only when it sits on a stone square; scrolls and floor messages share the database and use the main font
metadata:
  type: project
---

The text database serves three readers: a wall's inscription (a TEXT on a STONE square,
`DrawWallDecoration`, graphic 120, decode type 0), a scroll (`SCROLL.textReference`, main
font) and a message (a TEXT on any other square, `QuePrintLines`, decode type 1). A text's
number or its decoded bytes say nothing of which one it is.

**Why:** `DEBT.md` C103 claimed the French 1.3 texts #44 and #118 reached the wall font
with a code past its 36 glyphs. #44 is a scroll's and #118 a teleporter square's message,
so no data reached it, and a doc repeated the claim.

**How to apply:** before reasoning about how a text is drawn, find its square:
`npx tsx tools/peek-dungeon.ts [--file …] find "<words>"` gives the object that holds it,
and `cell <m> <x> <y>` the room type. `tools/checks/wall-text.ts` walks the wall texts only.
