---
name: curve-corner-check-is-trivial
description: The probe's hoverAt(0.002,0.002)==='0,0' passes with the CRT curve off too; only the (0.1,0.1) check proves the pointer is curved
metadata:
  type: project
---

In `tools/probe-frames.mjs`, `hoverAt(0.002, 0.002) === '0,0'` ("a point of the tube's
black corner is the screen's corner") holds with the curve off as well: the plain
scaling floors 0.002 x 320 to 0. It proves nothing about `canvasPoint`'s warp. The check
that does is `hoverAt(0.1, 0.1)`: `'32,20'` flat, nearer the corner curved.

**Why:** the fullscreen section once turned on the scanlines alone, where the curve was
meant, and its corner check still passed.

**How to apply:** when a probe section needs the curve on, assert it with the (0.1, 0.1)
point, or `settingsValues().curve`. See [[crt-invisible-to-frames]].
