---
name: dialog-layout-moves-probe-clicks
description: Changing a dialog's geometry breaks probe-frames.mjs's hard-coded canvas clicks, some far from the dialog's own block; a failed probe leaves no frames to look at
metadata:
  type: project
---

`tools/probe-frames.mjs` drives the settings, champion and save dialogs by hard-coded
canvas coordinates (`canvasClick`, `cdpMouse`, `touch`, `realClick`, `pointerAt`), some
of them in the fullscreen/CRT section far below the dialog's own block (`toggleCrt`, the
FULLSCREEN taps).

After a change to a dialog's geometry, grep the probe for the old coordinates and
recompute each from the new rectangles. Check that the point falls in the control's
*hit* rectangle: `buttonOf` takes six pixels off each side of a frame, while a tab
(`tabButtons`) takes the whole tab above its page.

When the probe fails, `check-frames.sh` deletes its temporary folder: there is no frame
to look at. Reproduce the step with `tools/probe-ui.mjs`, minding that its Chrome gives
a keyboard layout and the frames probe's does not ([[probe-frames-storage-flags]]).

**Why:** moving the settings dialog's content six rows up broke eleven clicks across
two sections of the probe.

**How to apply:** any change to `SettingsDialog`, `ChampionDialog` or `SaveMenu`
geometry. See [[new-golden-frame-needs-update]].
