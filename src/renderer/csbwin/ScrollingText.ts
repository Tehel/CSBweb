/**
 * CSBWin `SCROLLING_TEXT` — the 4-row scrolling message area at the bottom of the screen.
 *
 * Port of `doc/CSBwin-src/CSBCode.cpp:1274-1600` (SCROLLING_TEXT / LINEQUEUE) and the
 * `PrintLines` tokenizer at `doc/CSBwin-src/CSBCode.cpp:1674`.
 * Full spec and citations: `doc/CSBWIN_MESSAGES_REFERENCE.md`.
 *
 * Architecture, as in CSBWin: callers never draw. They enqueue fragments with
 * `quePrintLines()`; the game loop drains the queue through `printLines()`, which tokenizes
 * and word-wraps into `futureLines`; `clockTick()` then places pieces onto the four rows and
 * stamps their expiry.
 *
 * Two documented deviations:
 *  - The pixel-level scroll animation (`d.PushTextUp` / `d.TextScanlineScrollCount`) is not
 *    implemented; rows scroll instantly. All the guards CSBWin uses to wait for that
 *    animation are therefore absent. See DEBT.md G5 step 4.
 *  - CSBWin draws each piece once and lets the screen hold it; we re-render from the row
 *    model every frame because our screen buffer is cleared each frame. Same pixels.
 */

import { div } from '../../core/intCast';
import { fillRectIndex, type PaletteIndexViewportBuffer } from './CanvasBlitter';
import { drawTextLineIndex, type FontData } from './TextRenderer';

/** Rows in the message area (`d.TextTimeout[4]`). */
const NUM_ROWS = 4;
/** Row pitch in scanlines. */
const ROW_HEIGHT = 7;
/** Character cell width. */
const CHAR_WIDTH = 6;
/** Top scanline of row 0's clear rectangle (`172 + i*7`). */
const ROW_CLEAR_TOP_Y = 172;
/** Text draw baseline for row 0 (`row*7 + 177`). */
const TEXT_BASE_Y = 177;
const SCREEN_LAST_X = 319;
/** `TextWidth()/6` for the 320-wide screen. */
const MAX_COLUMNS = 53;
/** Indent applied to word-wrapped continuation rows. */
const WRAP_INDENT_COLUMN = 2;
/** `d.TextTimeout[row] = d.Time + 70`. */
const TEXT_TIMEOUT_TICKS = 70;
/** Timeout while the party sleeps. */
const TEXT_TIMEOUT_TICKS_SLEEPING = 700;

const LF = 10;

/** CSBWin `PIECE_OF_TEXT` (`doc/CSBwin-src/Data.h:1623`). */
interface TextPiece {
  row: number;
  col: number;
  color: number;
  text: string;
  printLinesCount: number;
  /**
   * CSBWin encodes the "scroll up and open a row at the bottom" command as a piece with
   * `m_row == -1`. We carry an explicit flag instead: `d.PrintRow` is itself -1 after
   * `DiscardText()`, so a real piece emitted before the first linefeed would otherwise be
   * mistaken for the marker. Behaviour is unchanged.
   */
  scrollMarker?: boolean;
}

interface QueuedFragment {
  color: number;
  text: string;
}

/** What is currently displayed on one row. */
interface PlacedPiece {
  col: number;
  color: number;
  text: string;
}

export class ScrollingText {
  /** `m_futureLines` — pieces waiting to be placed. */
  private futureLines: TextPiece[] = [];
  /** Pieces currently on each row (our stand-in for the persistent screen pixels). */
  private rows: PlacedPiece[][] = [[], [], [], []];
  /** `d.TextTimeout[4]`; -1 means the row is empty. */
  private textTimeout: number[] = [-1, -1, -1, -1];
  /** `m_printLinesCount[4]`. */
  private rowPrintLinesCount: number[] = [-1, -1, -1, -1];
  /** `d.PrintColumn` / `d.PrintRow`. Zero-initialised, like CSBWin's `d`. */
  private printColumn = 0;
  private printRow = 0;
  /** The `static i32 printLinesCount` inside CSBWin's `PrintLines`. */
  private printLinesCounter = 0;
  /** `printQueue` (`doc/CSBwin-src/CSBCode.cpp:200`). */
  private printQueue: QueuedFragment[] = [];
  /** `d.PartySleeping`. */
  private partySleeping = false;

  // ---------------------------------------------------------------- enqueueing

  /** CSBWin `QuePrintLines()` (`doc/CSBwin-src/CSBCode.cpp:1654`). */
  quePrintLines(color: number, text: string): void {
    if (!text) return;
    this.printQueue.push({ color: color | 0, text });
  }

  /**
   * CSBWin `PrintLinefeed()` (`doc/CSBwin-src/CSBCode.cpp:1744`) — queues the two-byte
   * `d.Byte1830` string, which holds a newline, with colour 0.
   */
  printLinefeed(): void {
    this.printQueue.push({ color: 0, text: '\n' });
  }

  // ------------------------------------------------------------------ pumping

  /**
   * Drain the print queue and place any pending text. CSBWin's main loop takes exactly one
   * entry per iteration (`doc/CSBwin-src/CSBCode.cpp:716`) at a rate far above the game
   * clock; our render pump runs at the 4 Hz tick, so we drain the whole queue at once.
   * Equivalent because `printLines()` ends with a `clockTick()` regardless.
   */
  pump(time: number): void {
    let guard = 0;
    while (this.printQueue.length > 0) {
      const entry = this.printQueue.shift();
      if (!entry) break;
      this.printLines(entry.color, entry.text, time);
      if (++guard > 1000) break;
    }
    this.clockTick(time);
  }

  /**
   * CSBWin `PrintLines()` (`doc/CSBwin-src/CSBCode.cpp:1674`): tokenize into words,
   * word-wrap at `MAX_COLUMNS`, honour explicit linefeeds.
   */
  printLines(color: number, text: string, time: number): void {
    this.printLinesCounter++;
    const count = this.printLinesCounter;
    let i = 0;

    while (i < text.length) {
      const code = text.charCodeAt(i);

      if (code === LF) {
        i++;
        // Suppress a leading blank row on a fresh area.
        if (this.printColumn !== 0 || this.printRow !== 0) {
          this.printColumn = 0;
          this.createNewTextRow(count);
        }
        continue;
      }

      if (code === 32) {
        i++;
        if (this.printColumn !== MAX_COLUMNS) this.printf(color, ' ', count);
        continue;
      }

      // Accumulate one word: always take the first character, then continue while the next
      // is neither space, linefeed nor end of string.
      let word = '';
      do {
        word += text[i++];
      } while (i < text.length && text.charCodeAt(i) !== 32 && text.charCodeAt(i) !== LF);

      if (this.printColumn + word.length > MAX_COLUMNS) {
        this.printColumn = WRAP_INDENT_COLUMN;
        this.createNewTextRow(count);
      }
      this.printf(color, word, count);
    }

    // "Get things on the screen right away."
    this.clockTick(time);
  }

  /**
   * CSBWin `SCROLLING_TEXT::Printf()` (`doc/CSBwin-src/CSBCode.cpp:1611`) plus the
   * `d.PrintColumn` advance that `LINEQUEUE::AddText()` performs
   * (`doc/CSBwin-src/CSBCode.cpp:1387`).
   */
  private printf(color: number, text: string, printLinesCount: number): void {
    this.futureLines.push({
      row: this.printRow,
      col: this.printColumn,
      color: color & 0x0f,
      text,
      printLinesCount,
    });
    this.printColumn += text.length;
  }

  /** CSBWin `SCROLLING_TEXT::CreateNewTextRow()` (`doc/CSBwin-src/CSBCode.cpp:1571`). */
  private createNewTextRow(printLinesCount: number): void {
    if (this.printRow < NUM_ROWS - 1) {
      this.printRow++;
      return;
    }
    this.futureLines.push({
      row: -1,
      col: 0,
      color: 0,
      text: '',
      printLinesCount,
      scrollMarker: true,
    });
  }

  /** CSBWin `LINEQUEUE::MaxPrintLinesCount()` (`doc/CSBwin-src/CSBCode.cpp:1378`). */
  private maxPrintLinesCount(): number {
    if (this.futureLines.length === 0) return -1;
    return this.futureLines[this.futureLines.length - 1].printLinesCount;
  }

  /** CSBWin `SCROLLING_TEXT::ClockTick()` (`doc/CSBwin-src/CSBCode.cpp:1519`). */
  clockTick(time: number): void {
    this.removeTimedOutText(time);

    for (;;) {
      const piece = this.futureLines[0];
      if (!piece) return;

      if (piece.scrollMarker) {
        // Don't scroll row 0 away while it still holds text belonging to this same batch.
        if (this.textTimeout[0] !== -1 && this.maxPrintLinesCount() <= this.rowPrintLinesCount[0]) {
          return;
        }
        this.scrollUp();
        this.rowPrintLinesCount[NUM_ROWS - 1] = piece.printLinesCount;
        this.futureLines.shift();
        continue;
      }

      const row = piece.row;
      if (row < 0 || row >= NUM_ROWS) {
        this.futureLines.shift();
        continue;
      }

      this.rows[row].push({ col: piece.col, color: piece.color, text: piece.text });

      this.textTimeout[row] = time + (this.partySleeping ? TEXT_TIMEOUT_TICKS_SLEEPING : TEXT_TIMEOUT_TICKS);
      // A row must never expire before the row above it.
      if (row > 0 && this.textTimeout[row - 1] !== -1 && this.textTimeout[row] <= this.textTimeout[row - 1]) {
        this.textTimeout[row] = this.textTimeout[row - 1];
      }
      this.futureLines.shift();
    }
  }

  /** CSBWin `SCROLLING_TEXT::RemoveTimedOutText()` (`doc/CSBwin-src/CSBCode.cpp:1479`). */
  private removeTimedOutText(time: number): void {
    for (let row = 0; row < NUM_ROWS; row++) {
      if (this.textTimeout[row] === -1) continue;
      if (this.textTimeout[row] > time) continue;
      this.rows[row] = [];
      this.textTimeout[row] = -1;
    }
  }

  /** CSBWin `SCROLLING_TEXT::ScrollUp()` (`doc/CSBwin-src/CSBCode.cpp:1583`). */
  private scrollUp(): void {
    for (let row = 0; row < NUM_ROWS - 1; row++) {
      this.rows[row] = this.rows[row + 1];
      this.textTimeout[row] = this.textTimeout[row + 1];
      this.rowPrintLinesCount[row] = this.rowPrintLinesCount[row + 1];
    }
    this.rows[NUM_ROWS - 1] = [];
    this.textTimeout[NUM_ROWS - 1] = -1;
  }

  /** CSBWin `SCROLLING_TEXT::DiscardText()` (`doc/CSBwin-src/CSBCode.cpp:1441`). */
  discardText(): void {
    this.futureLines = [];
    this.printQueue = [];
    this.rows = [[], [], [], []];
    for (let row = 0; row < NUM_ROWS; row++) {
      this.textTimeout[row] = -1;
      this.rowPrintLinesCount[row] = -1;
    }
    this.printRow = -1;
    this.printColumn = 0;
  }

  /** CSBWin `SCROLLING_TEXT::ResetTime()` (`doc/CSBwin-src/CSBCode.cpp:1564`). */
  resetTime(newTime: number, currentTime: number): void {
    for (let row = 0; row < NUM_ROWS; row++) {
      if (this.textTimeout[row] === -1) continue;
      this.textTimeout[row] += newTime - currentTime;
    }
  }

  /**
   * CSBWin `SCROLLING_TEXT::SetNewSpeed()` (`doc/CSBwin-src/CSBCode.cpp:1598`): what is left
   * of each live timeout, counted from `time`, rescaled from `oldSpeed` to `newSpeed` VBLs
   * per tick.
   */
  setNewSpeed(oldSpeed: number, newSpeed: number, time: number): void {
    if (oldSpeed === newSpeed) return;
    for (let row = 0; row < NUM_ROWS; row++) {
      if (this.textTimeout[row] < 0) continue;
      const delta = div((this.textTimeout[row] - time) * (oldSpeed + 1) + newSpeed, newSpeed + 1);
      this.textTimeout[row] = time + delta;
    }
  }

  /** `d.PartySleeping` — stretches message lifetime tenfold. */
  setPartySleeping(sleeping: boolean): void {
    this.partySleeping = sleeping;
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Render the four rows into the screen index buffer at CSBWin's geometry.
   * Text at `x = col*6`, `y = row*7 + 177` (`doc/CSBwin-src/CSBCode.cpp:1537`).
   */
  draw(buffer: PaletteIndexViewportBuffer, font: FontData): void {
    for (let row = 0; row < NUM_ROWS; row++) {
      const pieces = this.rows[row];
      if (pieces.length === 0) continue;
      const y = row * ROW_HEIGHT + TEXT_BASE_Y;
      for (const piece of pieces) {
        drawTextLineIndex(buffer, font, piece.col * CHAR_WIDTH, y, piece.color, null, piece.text);
      }
    }
  }

  /**
   * Clear the message strip. Our caller clears the whole screen buffer each frame, so this
   * is only needed by callers that composite differently; it mirrors the rectangles CSBWin
   * fills in `RemoveTimedOutText`/`DiscardText`.
   */
  clearArea(buffer: PaletteIndexViewportBuffer): void {
    for (let row = 0; row < NUM_ROWS; row++) {
      const top = ROW_CLEAR_TOP_Y + row * ROW_HEIGHT;
      fillRectIndex(buffer, { x1: 0, y1: top, x2: SCREEN_LAST_X, y2: top + ROW_HEIGHT - 1 }, 0);
    }
  }

  /** `d.TextTimeout[4]`, for tests and debugging. */
  timeouts(): readonly number[] {
    return this.textTimeout;
  }

  /** True when any row currently holds text (useful for tests/debug). */
  hasText(): boolean {
    return this.rows.some((row) => row.length > 0);
  }

  /** Snapshot of the visible rows, for tests and debugging. */
  snapshot(): string[] {
    return this.rows.map((pieces) => {
      if (pieces.length === 0) return '';
      let line = '';
      for (const piece of pieces) {
        while (line.length < piece.col) line += ' ';
        line = line.slice(0, piece.col) + piece.text;
      }
      return line;
    });
  }
}

/**
 * CSBWin keeps a single global `scrollingText` (`doc/CSBwin-src/CSBCode.cpp:1352`) with
 * free functions wrapping it. We mirror that so any layer can emit a message.
 */
export const scrollingText = new ScrollingText();

/** CSBWin `QuePrintLines()`. */
export function quePrintLines(color: number, text: string): void {
  scrollingText.quePrintLines(color, text);
}

/** CSBWin `PrintLinefeed()`. */
export function printLinefeed(): void {
  scrollingText.printLinefeed();
}
