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
`PushTextUp != 0` — it waits for the scroll animation to finish.

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
If a scroll is in progress it returns early and retries on the next tick.

`ResetTime(newTime)` rebases all live timeouts by `newTime - d.Time` (used when game time
is reloaded), and `SetNewSpeed` rescales them.

## Colours

Colour is per-fragment, passed to `QuePrintLines`. Known uses:

- **4** — spell messages / spell errors (`Magic.cpp:1004+`).
- **0** — the linefeed fragment itself (no visible glyphs).
- `d.Byte1386[...]` — per-champion colour for name fragments in combat messages
  (`CSBCode.cpp:6797`).

## Persistence

`SCROLLING_TEXT::Serialize` saves/loads the text area, so message state is part of a save
game (`Data.h:1666`).

## Implications for DMweb

Our current implementation routes gameplay text through the debug helper `updateDebug()`,
which sets whole pre-split lines and never expires them. To match CSBWin we need:

1. A two-stage queue (`quePrintLines` → drained in the game loop → `printLines`).
2. A fragment-based API, not whole-string messages, with word wrap at 53 columns and
   2-column continuation indent.
3. Four rows with per-row tick timeouts (70 / 700) plus the monotonic clamp.
4. Fill-downward-then-scroll-up row management.
5. Per-fragment colour, with 4 for spell messages.
6. Drawing into the 320×200 index buffer at the geometry above — not into DOM elements.
