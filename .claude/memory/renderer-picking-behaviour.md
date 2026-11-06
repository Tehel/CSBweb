---
name: renderer-picking-behaviour
description: viewport picking lives in renderer code; it reads the recording's behaviour through InterpreterContext.behaviour, a getter ScreenUI wires; and Data.h tables can carry pad bytes CSBWin never reads
metadata:
  type: project
---

The front wall's button 5 and `facingAlcove` are set while drawing (`DrawDecorations.ts`), and `SummarizeRoomInfo` decides decorations, so a picking fix there owes a `Behaviour.ts` flag like any engine fix. The renderer reads it as `draw.context.behaviour?.()` (`InterpreterContext.behaviour`, `ViewportRendererDeps.behaviour`, wired as `() => ctx.behaviour` in `ScreenUI.ts`): a getter, because `RecordingPlayer` reassigns `ctx.behaviour`. A tool building its own `ViewportRenderer` passes `behaviour: () => game.ctx.behaviour` to test an old level; without it the renderer plays the current one.

`Data.h` arrays may be sized with a pad: `Byte4038[4]` holds three alcove indices and a 0 that CSBWin never reads (`ObjectTables.isAlcoveDecoration`). When extracting a table, take the count from CSBWin's loops, not from the array's declared size.

**Why:** Conflux's line-44479 drift (`DEBT.md` F24) was that pad byte making decoration 0 an alcove, so a logged click on a switch touched nothing.

**How to apply:** for any drift where a logged click does nothing in the port, trace `ui.picking` at `handleClickInViewport` before suspecting the engine. See [[loadpartylevel-draws-mean-party-moved]].
