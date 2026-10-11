---
name: ui-hook-plumbing
description: A new hook from the page into the interface touches six places, the tools' default among them
metadata:
  type: project
---

A new hook or source the interface reads from the page (`UIState.settings`,
`isCrtAvailable`, `onExportSave`, …) is plumbed through six places, in this order:

1. the field on `UIState` (`src/renderer/ui/UIState.ts`), documented there;
2. the `UIHooks` Pick at the foot of `UIState.ts`;
3. `GameScreenHooks` in `src/renderer/GameScreen.ts`;
4. the `createUIState` call in the `GameScreen` constructor, which copies each hook;
5. the hooks object `construct()` in `src/main.ts` passes to `new GameScreen`;
6. the default in `tools/lib/ui.ts` (`newUIState`), and a line of its header.

**Why:** miss step 6 and every tool built on `newUIState` fails `tsc`; miss 3 or 4 and
the page's hook never reaches the interface, with no error.

**How to apply:** grep an existing hook (`onSleepSave`) across `src/` and `tools/lib/`
and add the new one beside it in each hit. See [[probe-gotchas]] for the live side.
