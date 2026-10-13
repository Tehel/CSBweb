---
name: probe-party-changes-dialog-cursor
description: In probe-frames.mjs, BUILD_PARTY gives the cursor an owner, so any later frame of a dialog with the pointer on it draws the hand instead of the arrow; build a party last on its page
metadata:
  type: project
---

`drawCursorItem` picks the cursor's shape from CSBWin's zones even while a dialog is up:
with a champion owning the cursor (`partyState.cursorOwner >= 0`), the pointer left of
x 224 over a dialog is the hand, not the arrow. So evaluating `BUILD_PARTY` on a page
changes every later frame on that page that shows a dialog with the pointer on the
canvas (frame 24, the KEYS tab, changed this way).

**Why:** a step that only needed a party for its own frame silently moved another
frame's baseline.

**How to apply:** a probe step that builds a party goes last on its page, just before
the next `Page.navigate`. If `check-frames.sh` reports an unexpected diff in a dialog
frame, look for a party built earlier on that page. See [[probe-frames-storage-flags]]
for where blocks go, and [[new-golden-frame-needs-update]].
