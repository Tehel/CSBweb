---
name: probe-app
description: Look at the running CSBweb app and read its live state — take a screenshot, click the canvas, evaluate an expression against the real game object. Use when a bug only shows on screen (a panel prints the wrong word, a click lands on the wrong champion, an object is in the chain but not drawn) and a headless tools/dump-*.ts therefore cannot see it.
---

# Probing the running app

`tools/dump-*.ts` stand the engine up without the UI, so they cannot see anything that goes
wrong *on screen*. `tools/probe-ui.mjs` drives the real page over the Chrome DevTools
Protocol instead, through the `window.__probe` handle `src/main.ts` exposes.

```bash
node tools/probe-ui.mjs 'game.ctx.party.state.champions.map(c => c && c.name)'
node tools/probe-ui.mjs --boot --shot /tmp/boot.png
node tools/probe-ui.mjs --click 15,15,right --shot /tmp/inv.png 'screen.ui.uiMode'
node tools/probe-ui.mjs --stop
```

Actions run in the order given; the bare argument is evaluated last, with `game`,
`screen` and `renderView` in scope, and printed as JSON. `renderView()` runs `DrawViewport`
and composes the screen over it, which is what a staged scene needs; in play only the tick
draws the view. `--help` lists them all.

## It is fast only if you let it be

The first call starts a dev server and a headless Chrome (~15s) and **leaves them up**.
Every later probe is about **one second**. So:

- Don't `--stop` between probes. Stop at the end of the session, or not at all.
- Don't `--boot` unless you need a clean, seeded world — it reloads and costs ~5s. Without
  it you are looking at whatever state the page is already in, which is usually what you
  want when you are drilling into a bug you just set up.
- **Ask for several things in one call.** `'[a, b, c]'` or an object literal is one round
  trip; three probes are three.

## Discovering the shape

The engine's API is not what you would guess — champions are at
`game.ctx.party.state.champions`, not `game.ctx.party.champions`. Don't guess twice; ask:

```bash
node tools/probe-ui.mjs 'Object.keys(game)'
node tools/probe-ui.mjs 'Object.keys(game.ctx.party.state)'
```

The expression is serialised with `JSON.stringify`, so `Map`s are converted and `bigint`s
stringified, but functions and cyclic references vanish. Project what you need
(`.map(c => c && c.name)`) rather than dumping a whole object — a champion is large, and it
lands in the conversation in full.

## Clicking

`--click X,Y[,right]` takes **canvas** pixels: 0–319 across, 0–199 down, the DM screen's own
coordinates, not browser pixels. `right` is DM's mouse mask 1 (right-click a party block to
open that champion's inventory); the default is mask 2. `doc/UI_MODULE_MAP.md` and
`src/renderer/ui/HitTest.ts` say what is where.

## What it is not

Nothing here asserts, so nothing here is evidence. The probe tells you *what* is wrong on
screen; once you know, reproduce it in a `tools/dump-*.ts` with an assertion that fails,
and fix it there — see the `playtest-bug` and `verification-tools` skills. A bug proved
only by a screenshot has no regression test.

## The handle

`src/main.ts` creates `window.__probe` under `__CSBWEB_PROBE__`, a build-time constant
(`vite.config.mts`), not under `isDebugFeaturesEnabled()` like the rest of the Phase 14
scaffolding. That is deliberate: the Debug toggle is applied from saved UI settings
*after* init runs, so it always reads false at that point. The constant is true on the
dev server, and in a build only with `CSBWEB_PROBE=1`, which `tools/check-image.sh` gives
the image it checks the golden frames against. A deployed bundle has no handle
(`tools/dump-build.ts` asserts it).

Leaving a probe browser running does not disturb `tools/check-frames.sh` — it reloads and
re-seeds the page itself. Verified: `npm test -- --frames` passes 34/34 with one up.
