---
name: probe-gotchas
description: Traps when driving the live app with probe-ui.ts — Position is a class mutated in place, picking rects are viewport-relative while button lists are screen coordinates, and a Promise prints {}
metadata:
  type: project
---

Three gotchas when poking live state through `tools/probe-ui.ts` (the `probe-app` skill):

- **`party.position` is a `Position` class instance** (`src/core/types.ts`) with
  `.north`/`.east`/… accessors. `p.position = {...p.position, x, y}` fails silently —
  `getForwardPosition` returns `undefined` and every wall click does nothing.
  **Mutate in place:** `p.position.x = 7; p.position.y = 9; p.position.z = 0;`
- **Two coordinate spaces.** `ui.context.wallDecorationRects` and the other picking
  rects are **viewport-relative** — add `VIEWPORT_Y = 33` to get a click position. The
  `graphic231.buttons.*` lists are already in **screen** coordinates, which is what
  `--click` takes.
- **The expression is wrapped synchronously** (`probed`), so a Promise prints `{}`, its
  work done unseen. Stash its result (`.then((v) => { window.__r = v; })`) and read
  `window.__r` in a second call; the page keeps it unless reloaded.

**Why:** each costs a round or two of clicks that silently do nothing.

**How to apply:** move the party by mutating fields; print both rect lists in one probe
call before choosing a click point.
