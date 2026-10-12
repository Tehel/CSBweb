---
name: text-changes-no-tests
description: A copy-only change to the welcome page (a text block, its CSS) needs no test or golden-frame run
metadata:
  type: feedback
---

Don't run `npm test` or `--frames` for a change that is only page copy: a text block on the
welcome page and its styling. A screenshot is enough to check the layout.

**Why:** the author stopped a `npm test -- --frames` run on a new Credits block: "it's a damn
text block".

**How to apply:** keep the full gate for code, the engine and the game's screen; for HTML
prose on the welcome page, look at it and stop there.
