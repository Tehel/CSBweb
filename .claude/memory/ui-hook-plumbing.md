---
name: ui-hook-plumbing
description: A new hook from the page into the interface touches four places, the tools' default among them
metadata:
  type: project
---

A new hook or source the interface reads from the page (`UIState.settings`,
`isCrtAvailable`, `onExportSave`, …) is plumbed through four places, in this order:

1. the field on `UIState` (`src/renderer/ui/UIState.ts`), documented there;
2. the `UIHooks` Pick at the foot of `UIState.ts` (`ScreenHooks`, `ScreenComposer.ts`, is
   it, less the composer's own two, and the `ScreenComposer` constructor spreads it whole);
3. the hooks object `construct()` in `src/main.ts` passes to `new GameScreen`;
4. the default in `tools/lib/ui.ts` (`newUIState`), and a line of its header.

**Why:** miss step 4 and every tool built on `newUIState` fails `tsc`; miss step 2 and
the hook is not a hook, so `createUIState` leaves the field unset, with no error.

**How to apply:** grep an existing hook (`onSleepSave`) across `src/` and `tools/lib/`
and add the new one beside it in each hit. See [[probe-gotchas]] for the live side.
