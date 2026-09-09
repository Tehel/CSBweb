/**
 * The name-entry screen a reincarnated champion is given.
 *
 * `_ReIncarnate` (`doc/CSBwin-src/Code13ea4.cpp:20`), reached from
 * `_ResurrectReincarnateCancel`'s button 161 (`doc/CSBwin-src/CSBCode.cpp:6738`) — the
 * *first* thing that branch does, before the skills are wiped and the penalties
 * charged. It blanks the champion's name and title and has the player type new ones,
 * either on the real keyboard or on the letter grid drawn in the viewport.
 *
 * CSBWin writes it as one `RESTARTABLE` loop that blocks the whole game until a name
 * is accepted. Nothing here can block, so the loop is turned inside out: the state
 * lives on `UIState`, `drawReincarnateScreen` redraws it from that state every frame,
 * and `reincarnateKey`/`reincarnateClick` are the body of the loop, run once per
 * event. The modality is real all the same — while `ui.reincarnate` is set, `Mouse.ts`
 * and the host's key handler give this module every click and every key, exactly as
 * `keyboardMode = 2` does in CSBWin.
 *
 * There is deliberately **no cancel**. CSBWin offers none: the only way out is a name
 * that is at least one character long and not already worn by another champion.
 *
 * ## The letter grid (`:174-210`)
 *
 * Screen coordinates, three rows of eleven cells on a 10-pixel pitch:
 *
 * - a click is on a cell only if `(x + 4) % 10 != 0` and `(y + 5) % 10 != 0` — the
 *   grid lines between the cells are dead. The one exception is the tall
 *   carriage-return key, which owns the line row at `x >= 207, y == 135`;
 * - the letter is `'A' + 11 * ((y - 116) / 10) + (x - 107) / 10`;
 * - codes 86 and 97 are the two halves of that carriage-return key, and become 13;
 * - anything above 86 shifts down by one to close the gap the key leaves;
 * - anything past `'Z'` indexes `d.SpecialChars` — comma, period, semi-colon, colon,
 *   space (`doc/CSBwin-src/Data.h:1422`).
 */
import { VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import { blitBasicGraphicToViewport } from './Draw';
import { UIState } from './UIState';

/** `d.CH16482[].name` is seven characters, the title nineteen (`:47-48`). */
const NAME_MAX = 7;
const TITLE_MAX = 19;

/** Where each field's first character sits, in *screen* coordinates (`:57-58`, `:281`). */
const NAME_X = 177;
const NAME_Y = 91;
const TITLE_X = 105;
const TITLE_Y = 109;
/** The font advances six pixels a character. */
const CHAR_WIDTH = 6;

/** The letter grid and the two buttons under it, all in screen coordinates. */
const GRID_X1 = 107;
const GRID_X2 = 215;
const GRID_Y1 = 116;
const GRID_Y2 = 144;
const OK_X1 = 197;
const OK_X2 = 215;
const BUTTON_Y1 = 147;
const BUTTON_Y2 = 155;
const BACKSPACE_X1 = 107;
const BACKSPACE_X2 = 175;

/** The stage of entry: CSBWin's `D6W`, 1 for the name and 2 for the title. */
export type ReincarnateStage = 1 | 2;

export interface ReincarnateState {
  /** The champion being renamed — always the potential one, the last in the party. */
  chIdx: number;
  stage: ReincarnateStage;
  /** `D7W` — how many characters of the current field are typed. */
  count: number;
  name: string;
  title: string;
}

/**
 * Open the screen (`:38-61`). Both fields start empty — CSBWin blanks them before the
 * loop, so a reincarnated champion cannot keep the hero text's name by doing nothing.
 */
export function openReincarnateScreen(ui: UIState, chIdx: number): void {
  ui.reincarnate = { chIdx, stage: 1, count: 0, name: '', title: '' };
}

export function isReincarnateScreenOpen(ui: UIState): boolean {
  return ui.reincarnate !== null;
}

/**
 * `D4W` (`:64-70`) — the title is full and no more will be taken. The name has no
 * equivalent: at seven characters it advances to the title on its own (`:253-255`).
 */
function fieldIsFull(state: ReincarnateState): boolean {
  return state.stage === 2 && state.count === TITLE_MAX;
}

/** Where the next character will land, which CSBWin tracks as `w_2` / `w_4`. */
function cursorPosition(state: ReincarnateState): { x: number; y: number } {
  return state.stage === 1
    ? { x: NAME_X + CHAR_WIDTH * state.count, y: NAME_Y }
    : { x: TITLE_X + CHAR_WIDTH * state.count, y: TITLE_Y };
}

export function drawReincarnateScreen(ui: UIState): void {
  const state = ui.reincarnate;
  if (!state || !ui.uiTables || !ui.screenIndexBuffer || !ui.fontData) return;

  // `FillRectangle(d.pViewportBMP, &rect_12, 12, 112)` (`:39-43`) — blank the strip the
  // champion's old name and title were drawn in.
  fillRectIndex(
    ui.screenIndexBuffer,
    {
      x1: VIEWPORT_X + 3,
      y1: VIEWPORT_Y + 3,
      x2: VIEWPORT_X + 170,
      y2: VIEWPORT_Y + 8,
    },
    12,
  );

  // `BLT2Viewport(GetBasicGraphicAddress(27), &d.wRectPos926, 72, 4)` (`:44-48`): the
  // keyboard, 72 bytes of source line (144 pixels) with 4 as the transparent colour.
  blitBasicGraphicToViewport(ui, 27, ui.uiTables.graphic232.wRectPos926, 144, 4);

  // The two blank fields, seven underscores and nineteen (`:49-50`).
  const buffer = ui.screenIndexBuffer;
  const font = ui.fontData;
  drawTextLineIndex(buffer, font, NAME_X, NAME_Y, 13, null, '_'.repeat(NAME_MAX));
  drawTextLineIndex(buffer, font, TITLE_X, TITLE_Y, 13, null, '_'.repeat(TITLE_MAX));

  // What has been typed so far, over the underscores. CSBWin draws each character once
  // as it arrives; redrawing the field is the same picture.
  if (state.name) drawTextLineIndex(buffer, font, NAME_X, NAME_Y, 13, 12, state.name);
  if (state.title) drawTextLineIndex(buffer, font, TITLE_X, TITLE_Y, 13, 12, state.title);

  // `TextOut_OneLine(…, 9, 12, d.Byte1414, …)` (`:71-79`) — the cursor, which is the
  // same underscore in colour 9. Not drawn once the field is full.
  if (!fieldIsFull(state)) {
    const cursor = String.fromCharCode(ui.uiTables.graphic232.byte1414[0] ?? 0x5f);
    const { x, y } = cursorPosition(state);
    drawTextLineIndex(buffer, font, x, y, 9, 12, cursor);
  }
}

/**
 * A key, as CSBWin's loop sees it (`:225-326`). `key` is a DOM `KeyboardEvent.key`.
 * Returns whether the screen consumed it — while it is open, it consumes everything.
 */
export function reincarnateKey(ui: UIState, key: string): boolean {
  const state = ui.reincarnate;
  if (!state) return false;

  let code: number;
  if (key === 'Enter') code = 13;
  else if (key === 'Backspace') code = 8;
  else if (key.length === 1) code = key.charCodeAt(0) & 0xff;
  else return true; // a modifier or an arrow: swallowed, as the modal loop swallows it

  applyCharacterCode(state, code);
  return true;
}

/**
 * A click, in screen coordinates (`:126-212`). The screen reads the mouse queue itself
 * rather than going through a button list, so this takes raw coordinates.
 */
export function reincarnateClick(ui: UIState, x: number, y: number): boolean {
  const state = ui.reincarnate;
  if (!state) return false;

  // OK (`:127-165`). Refused while the name is empty; always available once the title
  // stage is reached, even with an empty title.
  if (
    (state.stage === 2 || state.count > 0) &&
    x >= OK_X1 && x <= OK_X2 && y >= BUTTON_Y1 && y <= BUTTON_Y2
  ) {
    confirm(ui, state);
    return true;
  }

  // Backspace (`:166-173`).
  if (x >= BACKSPACE_X1 && x <= BACKSPACE_X2 && y >= BUTTON_Y1 && y <= BUTTON_Y2) {
    applyCharacterCode(state, 8);
    return true;
  }

  // The letter grid (`:174-210`).
  if (x >= GRID_X1 && x <= GRID_X2 && y >= GRID_Y1 && y <= GRID_Y2) {
    const code = gridCharacterAt(ui, x, y);
    if (code !== null) applyCharacterCode(state, code);
  }
  return true;
}

/**
 * The grid arithmetic of `:180-210`, kept in CSBWin's own order so the two odd cases
 * survive: the carriage-return key answering to two codes, and the shift that closes
 * the gap it leaves in the alphabet.
 */
export function gridCharacterAt(ui: UIState, x: number, y: number): number | null {
  // `D0W = (w_14+4) % 10` — a click on a vertical grid line is not on any key.
  if ((x + 4) % 10 === 0) return null;
  // Horizontal lines are dead too, except where the tall carriage-return key crosses
  // one: `(w_14>=207) && (w_16==135)`.
  if ((y + 5) % 10 === 0 && !(x >= 207 && y === 135)) return null;

  const rowStart = 11 * Math.floor((y - GRID_Y1) / 10);
  let code = rowStart + 'A'.charCodeAt(0) + Math.floor((x - GRID_X1) / 10);

  // 86 and 97 are the two cells of the carriage-return key.
  if (code === 86 || code === 97) return 13;
  // Everything past it shifts down one to close the gap.
  if (code >= 87) code--;
  if (code > 'Z'.charCodeAt(0)) {
    const special = ui.uiTables?.graphic232.specialChars ?? [];
    return special[code - 'Z'.charCodeAt(0) - 1] ?? null;
  }
  return code;
}

/** The tail of the loop (`:225-326`), shared by the keyboard and the letter grid. */
function applyCharacterCode(state: ReincarnateState, rawCode: number): void {
  let code = rawCode;
  // `if ((D5W>='a') && (D5W<='z')) D5W -= 32;`
  if (code >= 0x61 && code <= 0x7a) code -= 32;

  const isLetter = code >= 0x41 && code <= 0x5a;
  const isPunctuation = code === 0x2e || code === 44 || code === 59 || code === 58;
  const isSpace = code === 0x20;

  if (isLetter || isPunctuation || isSpace) {
    // `if (D5W==' ') { if (D7W == 0) continue; }` — no leading space, in either field.
    if (isSpace && state.count === 0) return;
    if (fieldIsFull(state)) return;

    const char = String.fromCharCode(code);
    if (state.stage === 1) state.name += char;
    else state.title += char;
    state.count++;

    // `if (D6W != 1) continue; if (D7W != 7) continue;` — a full name moves on by
    // itself, with no carriage return needed.
    if (state.stage === 1 && state.count === NAME_MAX) advanceToTitle(state);
    return;
  }

  if (code === 13) {
    // Return ends the name, and does nothing at all in the title (`:270-274`).
    if (state.stage !== 1) return;
    if (state.count <= 0) return;
    advanceToTitle(state);
    return;
  }

  if (code === 8) {
    // `if ((D6W==1) && (D7W==0)) continue;` — nothing to rub out (`:295-296`).
    if (state.stage === 1 && state.count === 0) return;
    if (state.count === 0) {
      // Backspacing off the front of the title steps back into the name and puts the
      // cursor **on** its last character, ready to replace it (`:311-318`).
      state.stage = 1;
      state.count = Math.max(0, state.name.length - 1);
      state.name = state.name.slice(0, state.count);
      return;
    }
    state.count--;
    if (state.stage === 1) state.name = state.name.slice(0, state.count);
    else state.title = state.title.slice(0, state.count);
    return;
  }
}

/** `tag0142c2` (`:283-289`) — hand the cursor to the title field. */
function advanceToTitle(state: ReincarnateState): void {
  state.stage = 2;
  state.count = 0;
}

/**
 * The OK button (`:127-165`).
 *
 * Trailing spaces are trimmed off the name before it is compared, and the comparison
 * runs against every champion **except the last** — the last is the one being named.
 * A duplicate is simply refused: CSBWin restores the untrimmed name and drops back
 * into the loop with no message, so the only feedback is that the screen does not go
 * away.
 */
function confirm(ui: UIState, state: ReincarnateState): void {
  const trimmed = state.name.replace(/ +$/, '');
  const champions = ui.partyState?.champions ?? [];
  for (let i = 0; i < champions.length - 1; i++) {
    if ((champions[i]?.name ?? '') === trimmed) return;
  }
  ui.reincarnate = null;
  ui.onReincarnateNamed?.(state.chIdx, trimmed, state.title);
}
