/**
 * CSBWin `SCROLLING_TEXT` — the 4-row scrolling message area at the bottom of the screen.
 *
 * Port of `doc/CSBwin-src/CSBCode.cpp:1274-1600` (SCROLLING_TEXT / LINEQUEUE) and the
 * `PrintLines` tokenizer at `doc/CSBwin-src/CSBCode.cpp:1674`.
 * Full spec and citations: `doc/CSBWIN_MESSAGES_REFERENCE.md`.
 *
 * Architecture, as in CSBWin: callers never draw. They enqueue fragments with
 * `quePrintLines()`; the main loop takes one entry a pass through `printNextQueued()`, whose
 * `printLines()` tokenizes and word-wraps into `futureLines`; `clockTick()` then places
 * pieces onto the four rows and stamps their expiry. A new row at the bottom scrolls the
 * strip up a scanline a VBL (`vblInterrupt()`), and nothing is placed or removed until the
 * scroll is over.
 *
 * CSBWin draws each piece once and lets the screen hold it, and its VBL handler moves those
 * pixels up. We re-render from the row model every frame, because our screen buffer is
 * cleared each frame: `draw` offsets the rows by the scroll count, and keeps the row that is
 * scrolling out until it has gone. Same pixels.
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
/** Top scanline of row 0's clear rectangle (`172 + i*7`), the top of the strip. */
const ROW_CLEAR_TOP_Y = 172;
/** The strip is scanlines 172-199. */
const STRIP_HEIGHT = NUM_ROWS * ROW_HEIGHT;
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
  /** `d.PushTextUp`: a scroll has started, and the VBL after its last scanline has not run. */
  private pushTextUp = 0;
  /**
   * `d.TextScanlineScrollCount`: the scanlines the strip has moved up in the scroll under
   * way, 0-6, or -1 once it has moved all seven, and before any scroll
   * (`doc/CSBwin-src/CSBCode.cpp:352`).
   */
  private textScanlineScrollCount = -1;
  /** The pieces of the row a scroll pushes off the top, until they have gone. */
  private scrollingOut: PlacedPiece[] = [];
  /** Set by whatever changes what the strip shows; `takeChanged()` clears it. */
  private changed = false;

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
   * `tag0007c8` (`doc/CSBwin-src/CSBCode.cpp:714-721`): the main loop takes one `printQueue`
   * entry a pass, whether or not a tick ran in it, and prints it.
   */
  printNextQueued(time: number): void {
    const entry = this.printQueue.shift();
    if (entry) this.printLines(entry.color, entry.text, time);
  }

  /**
   * The message strip's share of `vblInterrupt` (`doc/CSBwin-src/CSBCode.cpp:971-1004`).
   * While a scroll runs, the strip moves up a scanline and the count goes up; once it has
   * moved seven the count turns to -1, and the next VBL clears `d.PushTextUp`. CSBWin moves
   * the pixels and copies the blank `d.newTextLine` in at the bottom; `draw` offsets the rows
   * by the count instead. The bottom row is empty until the scroll is over, so that VBL's
   * copy changes nothing.
   */
  vblInterrupt(): void {
    if (this.textScanlineScrollCount < 0) {
      this.pushTextUp = 0;
      return;
    }
    this.textScanlineScrollCount++;
    if (this.textScanlineScrollCount === ROW_HEIGHT) {
      this.textScanlineScrollCount = -1;
      this.scrollingOut = [];
    }
    this.changed = true;
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
      if (this.textScanlineScrollCount >= 0) return; // wait for scrolling to cease
      if (this.pushTextUp !== 0) return; // wait for line to scroll
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
      this.changed = true;

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
      // "We'll get it next time."
      if (this.textScanlineScrollCount >= 0 || this.pushTextUp !== 0) return;
      this.rows[row] = [];
      this.textTimeout[row] = -1;
      this.changed = true;
    }
  }

  /** CSBWin `SCROLLING_TEXT::ScrollUp()` (`doc/CSBwin-src/CSBCode.cpp:1583`). */
  private scrollUp(): void {
    this.pushTextUp = 1;
    this.textScanlineScrollCount = 0; // Start the scrolling process
    this.scrollingOut = this.rows[0];
    for (let row = 0; row < NUM_ROWS - 1; row++) {
      this.rows[row] = this.rows[row + 1];
      this.textTimeout[row] = this.textTimeout[row + 1];
      this.rowPrintLinesCount[row] = this.rowPrintLinesCount[row + 1];
    }
    this.rows[NUM_ROWS - 1] = [];
    this.textTimeout[NUM_ROWS - 1] = -1;
  }

  /**
   * CSBWin `SCROLLING_TEXT::DiscardText()` (`doc/CSBwin-src/CSBCode.cpp:1441-1464`): the
   * pieces waiting and the pixels go, and the scroll stops. The print queue, the timeouts
   * and `d.PrintColumn` are left as they are.
   */
  discardText(): void {
    this.futureLines = [];
    this.rows = [[], [], [], []];
    this.scrollingOut = [];
    for (let row = 0; row < NUM_ROWS; row++) this.rowPrintLinesCount[row] = -1;
    this.printRow = -1;
    this.textScanlineScrollCount = -1;
    this.pushTextUp = 0;
    this.changed = true;
  }

  /**
   * The strip's share of a restart after a lost game, which runs `Cleanup(false)`,
   * `d.Initialize()`, `GameSetup` and `TAG021028` before `MainLoop` runs again
   * (`doc/CSBwin-src/Code1f9e6.cpp:302-316`):
   *
   * - `Cleanup(false)` → `CleanupGraphics` → `scrollingText.Cleanup()`
   *   (`data.cpp:2015`, `Graphics.cpp:2207`, `CSBCode.cpp:1434-1439`): the pieces waiting go.
   * - `d.Initialize()` zeroes `d` (`CSBCode.cpp:329`), `d.PushTextUp` and `d.PartySleeping`
   *   among it, and sets `d.TextScanlineScrollCount = -1` (`:352`).
   * - `GameSetup`'s `TAG001c6e` (`:10608`, `:1773-1779`): `SetPrintPosition(0, 0)` and the
   *   four `d.TextTimeout` -1.
   * - `TAG021028` fills the strip with colour 0, or clears the screen after a load
   *   (`:10536`, `:10543`), and sets `d.PartySleeping = 0` (`:10479`).
   *
   * `m_printLinesCount`, `PrintLines`' static count and `printQueue` (`:200`), which only
   * the main loop drains (`:716`), are left as they are.
   */
  restart(): void {
    this.futureLines = [];
    this.pushTextUp = 0;
    this.textScanlineScrollCount = -1;
    this.printColumn = 0;
    this.printRow = 0;
    for (let row = 0; row < NUM_ROWS; row++) this.textTimeout[row] = -1;
    this.rows = [[], [], [], []];
    this.scrollingOut = [];
    this.partySleeping = false;
    this.changed = true;
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
   * Text at `x = col*6`, `y = row*7 + 177` (`doc/CSBwin-src/CSBCode.cpp:1537`). While a scroll
   * runs, every row sits `7 - count` scanlines below its place, and the row scrolling out
   * sits above row 0, cut off at the top of the strip.
   */
  draw(buffer: PaletteIndexViewportBuffer, font: FontData): void {
    const strip: PaletteIndexViewportBuffer = {
      width: buffer.width,
      height: STRIP_HEIGHT,
      pixels: buffer.pixels.subarray(ROW_CLEAR_TOP_Y * buffer.width, (ROW_CLEAR_TOP_Y + STRIP_HEIGHT) * buffer.width),
    };
    const offset = this.textScanlineScrollCount >= 0 ? ROW_HEIGHT - this.textScanlineScrollCount : 0;
    for (let row = -1; row < NUM_ROWS; row++) {
      const pieces = row < 0 ? this.scrollingOut : this.rows[row];
      if (pieces.length === 0) continue;
      const y = row * ROW_HEIGHT + TEXT_BASE_Y - ROW_CLEAR_TOP_Y + offset;
      for (const piece of pieces) {
        drawTextLineIndex(strip, font, piece.col * CHAR_WIDTH, y, piece.color, null, piece.text);
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

  /** Whether the strip has changed since the last call; the host redraws the screen when it has. */
  takeChanged(): boolean {
    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  /** `d.PushTextUp` and `d.TextScanlineScrollCount`, for tests and debugging. */
  scrollState(): { pushTextUp: number; textScanlineScrollCount: number } {
    return { pushTextUp: this.pushTextUp, textScanlineScrollCount: this.textScanlineScrollCount };
  }

  /** The entries in `printQueue` and the pieces in `m_futureLines`, for tests and debugging. */
  backlog(): { printQueue: number; futureLines: number } {
    return { printQueue: this.printQueue.length, futureLines: this.futureLines.length };
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
 * CSBWin keeps a single global `scrollingText` (`doc/CSBwin-src/CSBCode.cpp:1352`). The
 * engine reaches this one through its host's `messages`.
 */
export const scrollingText = new ScrollingText();

