---
name: frames-first-navigation-flake
description: probe-frames.ts sometimes times out on its first game page (`?intro=0&dungeon=dm-atari`, line ~363) right after the welcome-page checks; rerun once before chasing it
metadata:
  type: project
---

`tools/check-frames.sh` failed in 2 of 4 runs on 2026-11-07, each on fresh ports, with
`timed out waiting for http://localhost:<port>/?intro=0&dungeon=dm-atari` at
`tools/probe-frames.ts:363`, the first game page after the welcome-page checks, before
any frame. A rerun on new ports passed every check. The cause is not verified; a cold
Vite dev server optimising its dependencies is the likely one.

**Why:** the timeout comes before anything a change to the game touches, and chasing it
costs a session.

**How to apply:** at that exact error, rerun once on new ports
([[frames-on-fresh-ports]]); only a second failure is worth investigating, and comparing
with HEAD first ([[wsl-known-failures]]).
