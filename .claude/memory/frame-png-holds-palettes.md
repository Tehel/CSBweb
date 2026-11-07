---
name: frame-png-holds-palettes
description: a golden frame's PNG holds its palettes in a `csbweb-frame` text chunk and its pixels are palette slots; read a slot's colour there, not in the loaders
metadata:
  type: reference
---

A golden frame (`tools/frames/*.png`, `tools/lib/frames.ts`) is a paletted PNG whose pixels
are palette slots, with a `csbweb-frame` text chunk listing the palettes it was shown
through as Atari `0RGB` words (`ui 0000 0333 …`, `viewport …`). In Python:
`Image.open(p).info['csbweb-frame']`, and `im.getpixel((x, y))` on the unconverted image
gives the slot.

The interface's palette, as the frames show it: 0 `0000` black, 1 `0333`, 2 `0444` (the
widgets' `DIM_COLOR`), 3 `0310` dark brown (the viewer's strip's darker columns), 4 `0066`
cyan, 5 `0420` the menu panel, 9 `0750` the menu's text, 11 `0770` lit, 12 `0222`,
15 `0777` white.

**Why:** finding "which slot is that colour" through the graphics loaders costs several
greps; the frame answers in one command.

**How to apply:** before choosing a colour for a port-own widget, or when a frame's
pixels need reading. See [[new-golden-frame-needs-update]].
