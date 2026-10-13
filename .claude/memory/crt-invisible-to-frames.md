---
name: crt-invisible-to-frames
description: The golden frames read palette indices, never the WebGL CRT canvas; eyeball the shader with a probe-ui page screenshot after a settings.update
metadata:
  type: project
---

A golden frame is the 320x200 screen's palette slots (`tools/lib/frames.mjs`), read
from the game canvas's buffer, so the CRT effect (`src/lib/crt.ts`, `#crt-canvas`) is in
no frame: a shader change passes `check-frames.sh` whatever it draws. The probe only
asserts the effect is shown and the pointer is read through the curve.

To see it, `tools/probe-ui.mjs --shot` is `Page.captureScreenshot`, the whole page, the
WebGL canvas included. The expression runs after the actions, so set the settings in
one call and shoot in the next:

```bash
node tools/probe-ui.mjs --boot 'screen.ui.settings.update({scanlines:true, curve:false})'
node tools/probe-ui.mjs --wait 400 --shot <scratch>/scan.png 'screen.ui.settings.update({scanlines:false, curve:true})'
node tools/probe-ui.mjs --wait 400 --shot <scratch>/curve.png
```

Its headless Chrome gives WebGL (SwiftShader); `crtEffect()` in the frames probe fails
the run where a Chrome does not.

**Why:** the only proof a shader change looks right is a look at it.

**How to apply:** any change to `crt.ts`'s shader or to which settings turn it on. See
[[curve-corner-check-is-trivial]].
