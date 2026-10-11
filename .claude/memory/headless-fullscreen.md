---
name: headless-fullscreen
description: How headless Chrome behaves under the probe for fullscreen, Keyboard Lock and user activation: which CDP input counts as a gesture, and what cannot be proved there
metadata:
  type: project
---

Measured in headless Chrome (`--headless=new`) over CDP, for `src/lib/fullscreen.ts`:

- **Only CDP's own input is a gesture.** `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`
  grant user activation; the probe's synthetic `canvasClick` / `key` (`dispatchEvent`) do
  not, so `requestFullscreen` from them is refused. A new document starts with none.
- **A finger's press is no gesture**, its lift is: under `Emulation.setTouchEmulationEnabled`,
  `navigator.userActivation.isActive` is false at `pointerdown` and true at `pointerup`.
- **In fullscreen the viewport is `Emulation.setDeviceMetricsOverride`'s**, so the probe
  picks the "screen" size with it (without an override it is 800x600), and changing it in
  fullscreen fires `resize`.
- **`navigator.keyboard.lock(['Escape'])` resolves**, and a CDP Esc reaches the page. But a
  CDP Esc never leaves fullscreen there, lock or not, so headless cannot prove what Esc
  does without the lock: that half rests on the browsers' documented behaviour.

**Why:** a fullscreen check driven by synthetic events fails for want of activation, not
for a bug; and a passing Esc check proves less than it seems.

**How to apply:** drive fullscreen with `cdpMouse` / `touch` / a CDP key, never `canvasClick`.
See [[probe-frames-storage-flags]] and [[probe-gotchas]].
