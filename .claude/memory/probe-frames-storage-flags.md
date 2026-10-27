---
name: probe-frames-storage-flags
description: probe-frames.ts wipes localStorage and IndexedDB on every load unless keepsettings/keepsaves, and hides the keyboard layout (KEYS shows KEY LABELS); where a new block goes and which helpers it may use
metadata:
  type: project
---

`tools/probe-frames.ts` injects a script into every new document
(`Page.addScriptToEvaluateOnNewDocument`) that clears `localStorage` unless the URL
holds `keepsettings`, and deletes the `csbweb-saves` IndexedDB unless it holds
`keepsaves`, and seeds `Math.random`. Injected scripts accumulate: the CRT section near
the end adds one that saves `crt: true` on every later load.

- A check that something survives a reload navigates with `?intro=0&keepsaves&keepsettings`.
- A new block goes **before** "The CRT effect's input surface", after frame 20.
- `realMouse`, `leaveCanvas`, `selected` are `const`s defined mid-file: a block placed
  above their definition hits the temporal dead zone. Define a local helper instead.
- The injected script also hides `navigator.keyboard`: the frames probe sees no keyboard
  layout, so KEYS shows KEY LABELS and its list starts lower. `probe-ui.ts`'s Chrome
  gives one, and there the same tab has no KEY LABELS: a coordinate found in a
  `probe-ui` session can miss here (a slot click did, and cost a 4-minute run).
- `canvasClick` dispatches mouse pointer events, which move no hover point (only a
  non-mouse press does, `bindCanvasEvents`); dispatch a `pointermove` for hover.

**Why:** a reload test that silently lost its state, or a block that crashed on a
helper defined below it, each cost a full ~2-minute probe run.

**How to apply:** read this before adding anything to the probe; see
[[new-golden-frame-needs-update]] for adding frames.
