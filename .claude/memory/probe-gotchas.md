---
name: probe-gotchas
description: Two traps when driving the live app with probe-ui.mjs — Position is a class mutated in place, and picking rects are viewport-relative while button lists are screen coordinates
metadata:
  type: project
---

Two gotchas when poking live state through `tools/probe-ui.mjs` (the `probe-app` skill):

- **`party.position` is a `Position` class instance** (`src/core/types.ts`) with
  `.north`/`.east`/… accessors. `p.position = {...p.position, x, y}` fails silently —
  `getForwardPosition` returns `undefined` and every wall click does nothing.
  **Mutate in place:** `p.position.x = 7; p.position.y = 9; p.position.z = 0;`
- **Two coordinate spaces.** `ui.context.wallDecorationRects` and the other picking
  rects are **viewport-relative** — add `VIEWPORT_Y = 33` to get a click position. The
  `graphic231.buttons.*` lists are already in **screen** coordinates, which is what
  `--click` takes.

**Why:** each costs a round or two of clicks that silently do nothing.

**How to apply:** move the party by mutating fields; print both rect lists in one probe
call before choosing a click point.
