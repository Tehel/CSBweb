---
name: frames-first-navigation-flake
description: probe-frames.ts sometimes times out on its first game page (`?intro=0&dungeon=dm-atari`, line ~363) on a cold dev server; run it against one started and warmed beforehand
metadata:
  type: project
---

`tools/check-frames.sh` failed in 2 of 4 runs on 2026-11-07, each on fresh ports, with
`timed out waiting for http://localhost:<port>/?intro=0&dungeon=dm-atari` at
`tools/probe-frames.ts:363`, the first game page after the welcome-page checks, before
any frame. A rerun on new ports passed every check. On 2026-11-07 it failed twice in a
row on fresh ports, and passed at once against a dev server started beforehand
(`npx vite --port 9330 --strictPort`) and warmed with a `curl` of the page and
`/src/main.ts`, which `check-frames.sh` reuses: a cold Vite optimising its dependencies.

**Why:** the timeout comes before anything a change to the game touches, and chasing it
costs a session.

**How to apply:** at that exact error, start a dev server on a fresh port, `curl` it
warm, and run `DEV_PORT=<it> CDP_PORT=<another> bash tools/check-frames.sh`
([[frames-on-fresh-ports]]); only a failure then is worth investigating, comparing with
HEAD first ([[wsl-known-failures]]). Kill the server after.
