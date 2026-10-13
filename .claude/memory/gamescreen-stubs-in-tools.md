---
name: gamescreen-stubs-in-tools
description: Three dialog tools hand GameInput a GameScreen stub cast `as unknown as GameScreen`; a new method GameInput calls passes tsc and crashes them at run time
metadata:
  type: project
---

`tools/dump-settings-dialog.ts`, `tools/dump-map-dialog.ts` and
`tools/dump-champion-dialog.ts` drive the real `GameInput` over a hand-built `screen`
object cast `as unknown as GameScreen`. The cast hides a missing method from `tsc`, so
a new `GameScreen` method that `GameInput` calls (as `screenPoint` was) makes all three
throw `this.host.screen.<name> is not a function` in `npm test`, not at type-check.

**Why:** `tsc` passed, and the failure only showed in the full `npm test` run.

**How to apply:** when `GameInput` starts calling something new on its host's screen,
grep `as unknown as GameScreen` in `tools/` and add the method to each stub, usually as
an identity or a no-op. The page-to-interface hooks have their own checklist,
[[ui-hook-plumbing]].
