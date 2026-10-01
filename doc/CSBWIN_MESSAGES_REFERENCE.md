# CSBWin Message Area Reference (Sourced)

Verified from `doc/CSBwin-src/`. This is the scrolling text area at the bottom of the
screen used for all in-game messages (actuator texts, spell errors, level-ups, combat).

## Geometry

- **4 rows**, indices 0 (top) .. 3 (bottom).
- Row `i` occupies scanlines `172 + i*7` .. `172 + i*7 + 6` (7 px tall), full width `x = 0..319`
  — this is the rectangle cleared on timeout (`SCROLLING_TEXT::RemoveTimedOutText`,
  `doc/CSBwin-src/CSBCode.cpp:1479`).
- Text is drawn at `x = column * 6`, `y = row * 7 + 177`
  (`SCROLLING_TEXT::ClockTick`, `doc/CSBwin-src/CSBCode.cpp:1519`).
- Character cell is **6 px wide**; line width is `TextWidth()/6` = **53 columns** for the
  320-wide screen (`PrintLines`, `doc/CSBwin-src/CSBCode.cpp:1674`).
- `SetPrintPosition` clamps column to 0..52 and row to 0..3 (`CSBCode.cpp:1467`).

## Queue architecture (two stages)

Callers never draw directly. `PrintLines` used to be restartable, so everything was
changed to enqueue instead (comment at `doc/CSBwin-src/CSBCode.cpp:1645`):

1. `QuePrintLines(color, text)` → `printQueue.Queue(color, 1, text)` (`CSBCode.cpp:1654`).
2. The **main loop** drains one entry per iteration and calls the real
   `PrintLines(color, text)` (`CSBCode.cpp:716`).
3. `PrintLines` tokenizes and appends into `m_futureLines`; `scrollingText.ClockTick()` then
   moves `m_futureLines` onto the screen.

## Text composition — messages are built from FRAGMENTS, not lines

A message is emitted as a leading linefeed followed by several appended fragments that flow
onto **one logical line**, word-wrapped by `PrintLines`. Example — `SpellErrorMsg`
(`doc/CSBwin-src/Magic.cpp:1004`):

```cpp
PrintLinefeed();
QuePrintLines(4, pChar->name);
QuePrintLines(4, " NEEDS MORE PRACTICE WITH THIS ");
QuePrintLines(4, d.Pointer16596[P3]);   // class name
QuePrintLines(4, " SPELL.");
```

- `PrintLinefeed()` is `QuePrintLines(0, d.Byte1830)`, where `Byte1830` is a 2-byte string
  holding a newline (`CSBCode.cpp:1744`, `Data.h:1396`).
- **Do not embed `\n` between the champion name and the message body.** Hard newlines are
  only for deliberate paragraph breaks; normal messages rely on word wrap.

### `PrintLines` tokenizer rules (`CSBCode.cpp:1674`)

- Char `10` (LF): advance to a new row via `CreateNewTextRow()`, but **only if**
  `PrintColumn != 0 || PrintRow != 0` (avoids a leading blank line on a fresh area).
- Char `32` (space): emit a single space, **unless** already at the last column.
- Otherwise: accumulate a word up to the next space/LF/NUL. If `PrintColumn + wordLen`
  exceeds 53, set `PrintColumn = 2` and start a new row — i.e. **wrapped continuation lines
  are indented by 2 columns**.
- Ends with `scrollingText.ClockTick()` so text appears immediately.

## Row advance and scrolling

`CreateNewTextRow()` (`CSBCode.cpp:1571`):
- If `PrintRow < 3`: just `PrintRow++` (still filling the area downward, top to bottom).
- Else: queue a marker row (`row = -1`) that triggers `ScrollUp()`.

`ScrollUp()` (`CSBCode.cpp:1583`): shifts `TextTimeout[i] = TextTimeout[i+1]` for i=0..2,
sets `TextTimeout[3] = -1`, and starts a pixel-level scroll animation via
`d.PushTextUp = 1` / `d.TextScanlineScrollCount = 0`.

`ClockTick` refuses to place new text while `TextScanlineScrollCount >= 0` or
`PushTextUp != 0` — it waits for the scroll animation to finish (`CSBCode.cpp:1526-1527`).

### The scroll animation

The VBL handler runs it (`vblInterrupt`, `doc/CSBwin-src/CSBCode.cpp:971-1004`), one
scanline per VBL. `checkVBL` calls `vblInterrupt` before it hands the main loop the VBL's
`UIM_VBL` (`system.cpp:624-630`, dispatched at `CSBUI.cpp:1253-1272`), so each VBL's
scanline moves before that VBL's pass of the loop. The count starts at -1
(`CSBCode.cpp:352`).

- While `TextScanlineScrollCount >= 0`: move scanlines 173 .. `199 - count` up one (the
  strip is 28 scanlines, 172-199), then `count++`, and copy `count` scanlines of
  `d.newTextLine` to the bottom of the screen, from scanline `200 - count`. When the count
  reaches 7 it becomes -1.
- Otherwise, if `PushTextUp != 0`: clear it and copy 7 scanlines of `d.newTextLine` to
  scanlines 193-199.

`ScrollUp` clears `d.newTextLine` (`:1587`), and nothing writes it since `Printf` stopped
drawing (its old body is commented out, `:1616-1642`), so what comes in at the bottom is
blank. After seven VBLs every row sits 7 scanlines higher and the bottom row is empty; the
eighth clears `PushTextUp`. `RemoveTimedOutText` also waits for both (`:1505-1508`), and
`DiscardText` stops the scroll (`TextScanlineScrollCount = -1`, `PushTextUp = 0`,
`:1447-1448`). `DiscardText` also drops the pieces waiting and blanks the strip, but leaves
the print queue, the timeouts and `d.PrintColumn` alone (`:1441-1464`). Its only caller is
the DSA opcode `STKOP_DiscardText` (`DSA.cpp:3161-3166`).

### When the queue is drained

The main loop takes one `printQueue` entry per pass, at `tag0007c8`, whether or not a tick
ran in that pass (`CSBCode.cpp:714-721`), so a message queued by a click reaches
`PrintLines` without waiting for a tick. A frozen loop still takes them
(`if (d.ClockRunning == 0) goto tag0007b4;`, `:765`); the disk menu holds the loop in
`DisplayDiskMenu` (`:762`), so none is taken while it is open. The tick's own
`scrollingText.ClockTick()` comes after `ProcessTimers` and `d.Time++` (`:660`, `:677`).

`ClockTick` has three callers: the tick (`:677`), the end of `PrintLines` (`:1736`), and
`_ProcessTimersViewportAndSound` (`Attack.cpp:2211`), the fusion's loop. A piece that a
scroll holds back is placed by the first of them after the scroll: with the print queue
empty, that is the next tick.

## Timeouts

Per-row expiry in `d.TextTimeout[4]`, set when a row is drawn (`ClockTick`):

- Normal: `d.TextTimeout[row] = d.Time + 70`
- Party sleeping: `d.Time + 700`
- **Monotonic clamp**: if `row > 0` and `TextTimeout[row-1] != -1` and
  `TextTimeout[row] <= TextTimeout[row-1]`, then `TextTimeout[row] = TextTimeout[row-1]`.
  This stops a lower line from vanishing before the line above it.

`d.Time` increments once per game clock tick (`CSBCode.cpp:660`). At our 4 ticks/sec that
makes 70 ticks ≈ 17.5 s, consistent with the ~15 s observed in the real game. (An old
comment in the C++ source guesses "about 10 seconds"; the authoritative fact is **70 ticks**,
not a wall-clock duration.)

`RemoveTimedOutText()` clears the row's rectangle to colour 0 and sets `TextTimeout = -1`.
If a scroll is in progress it returns early, and the row goes at a later `ClockTick`.

`ResetTime(newTime)` rebases all live timeouts by `newTime - d.Time` (`CSBCode.cpp:1564`).
`LoadGame` calls it with the saved time just before it sets `d.Time`
(`SaveGame.cpp:1623-1624`).

`SetNewSpeed(oldSpeed, newSpeed)` rescales every live timeout to a new `d.Speed`, the VBLs
per tick: `delta = TextTimeout - d.Time`, then
`delta = (delta*(oldSpeed+1) + newSpeed)/(newSpeed+1)` (`CSBCode.cpp:1598-1609`). Sleep calls
it with `(d.Speed, 0)` (`Mouse.cpp:1696`), `WakeUp` with
`(d.Speed, speedTable[gameSpeed].vblPerTick)` (`CSBCode.cpp:7053`), and the top of every tick
while awake with the same arguments (`:612-616`). At the default `SPEED_NORMAL`, 15 VBLs per
tick (`data.cpp:275`, `CSBwin.cpp:180`), falling asleep multiplies what is left of each
timeout by 16, and waking divides it by 16, rounding up.

## Colours

Colour is per-fragment, passed to `QuePrintLines`. Known uses:

- **4** — spell messages / spell errors (`Magic.cpp:1004+`).
- **0** — the linefeed fragment itself (no visible glyphs).
- `d.Byte1386[...]` — per-champion colour for name fragments in combat messages
  (`CSBCode.cpp:6797`).

## Persistence

CSBWin saves no message state. `SCROLLING_TEXT::Serialize` is declared
(`doc/CSBwin-src/Data.h:1665`) but has no body and no caller anywhere in the tree. A load
keeps whatever is on screen and rebases its timeouts (`ResetTime`, above).

A restart after a lost game empties the strip (`Code1f9e6.cpp:302-316`). `Cleanup(false)`
runs `CleanupGraphics` (`data.cpp:2015`), whose `scrollingText.Cleanup()`
(`Graphics.cpp:2207`) frees the three line lists (`CSBCode.cpp:1434-1439`), the pieces
waiting among them. `d.Initialize()` zeroes `d` (`CSBCode.cpp:329`) — `d.PrintColumn`,
`d.PrintRow`, `d.PushTextUp`, `d.PartySleeping` — and sets `d.TextScanlineScrollCount = -1`
(`:352`). `GameSetup`'s `TAG001c6e` (`:10608`) sets the print position to (0, 0) and the
four `d.TextTimeout` to -1 (`:1773-1779`). `TAG021028` fills the strip with colour 0, or
clears the whole screen after a load (`:10536`, `:10543`), and sets `d.PartySleeping = 0`
again (`:10479`). Nothing touches `m_printLinesCount`, `PrintLines`' static count, or
`printQueue` (`:200`), a global whose only reader is the main loop's `GetEntry` (`:716`):
an entry still queued when `MainLoop` returned is printed in the new game's first pass.

## The port

`src/renderer/csbwin/ScrollingText.ts` ports the queue, the tokenizer, the four rows and
their timeouts with `SetNewSpeed`, the scroll and its guards, and draws into the 320×200
index buffer at the geometry above. CSBWin's one global is, in the port, one instance
the page builds (`construct`, `src/main.ts`) and hands to both sides: the engine writes it
through `GameHost.messages`, and the screen draws the one in its `GameScreenDeps`.

What the engine does with it:

- `Game.runFrame` is one VBL: `vblInterrupt()` first, then the loop's pass, which ends
  with `printNextQueued()`, one entry, unless the save menu has the clock stopped.
- The tick calls `clockTick()` after the timers.
- Sleep and `WakeUp` call `setNewSpeed` with `d.Speed` (`speed` in
  `src/engine/LoopState.ts`), and every load calls `resetTime` just before it replaces the
  tick count (`applyRuntimeSaveState`).
- A restart calls `restart()` (`showEndOfGame`, `src/main.ts`).

One emitter is the port's own. F5 and F9, which CSBWin does not have, say what they did
through the same pair, a linefeed and one fragment in colour 15 (`GameSaves.tell`,
`src/engine/GameSaves.ts`): "GAME SAVED", "CANNOT SAVE NOW", and the like
(`PLAN.md` → Phase 10, "The menu").

The port redraws the strip every frame from its row model: `draw` offsets the rows by the
scroll count and keeps the row scrolling out until it has gone, and `main.ts` redraws the
screen after any frame in which the strip changed. CSBWin's loop also makes a pass for a
mouse button going down, and the port's deliberately does not (`DEBT.md` → H). Evidence:
`tools/dump-messages.ts`.
