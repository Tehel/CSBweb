---
name: dialog-layout-moves-probe-clicks
description: Changing a dialog's geometry, or reordering a settings tab, breaks probe-frames.mjs's hard-coded canvas clicks, some far from the dialog's own block; a failed probe leaves no frames to look at
metadata:
  type: project
---

`tools/probe-frames.mjs` drives the settings, champion and save dialogs by hard-coded
canvas coordinates (`canvasClick`, `cdpMouse`, `touch`, `realClick`, `pointerAt`), some
of them in the fullscreen/CRT section far below the dialog's own block (`toggleCrt`, the
FULLSCREEN taps).

The GAME and DISPLAY tabs are a grid of two buttons a line: x 85 (left) or 236
(right), y 65, 86 or 107 for the three lines; setting `n` of `TABS` is
`settingButtonFrame(n)`, line `n >> 1`, side `n & 1`. **Reordering a tab's settings** is
a geometry change too: the indices in `tools/dump-settings-dialog.ts`, the probe's
clicks (its DISPLAY clicks in three places: `toggleCrt`'s `SCANLINES`/`CURVE`, ASPECT
RATIO's after frame 22, and the fullscreen section's FULLSCREEN and effect clicks), and
frames 21 and 22.

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
geometry, or to the order of a settings tab's `TABS` entries. See
[[settings-dialog-reopens-last-tab]] for where it opens. See [[new-golden-frame-needs-update]].
