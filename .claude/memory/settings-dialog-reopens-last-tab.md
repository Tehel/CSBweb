---
name: settings-dialog-reopens-last-tab
description: The settings dialog opens on GAME only the first time on a page; after that on the tab and KEYS scroll it was closed on (UIState.settingsDialogLast)
metadata:
  type: project
---

`openSettingsDialog` opens on `ui.settingsDialogLast`: GAME and the KEYS list at its top
on a new `UIState`, and afterwards the tab and KEYS' `scrollTop` it was last closed on
(`closeSettingsDialog` records them). It lives in memory only: a reload or a navigation
starts on GAME again.

So a tool that opens the dialog twice on the same `ui`, or a probe step that opens it
again on the same page, is on whatever tab the last step left. Click the tab wanted
(`TAB_FRAMES[i]` in a tool, `canvasClick(x, 45)` in the probe: GAME 40, DISPLAY 120,
SOUND 197, KEYS 240), or start from `freshUI()` / a `Page.navigate`.

**Why:** "Esc opens it on GAME" held for every open before this; a step written that way
silently lands on another tab.

**How to apply:** any new step or tool that opens the settings dialog. See
[[dialog-layout-moves-probe-clicks]].
