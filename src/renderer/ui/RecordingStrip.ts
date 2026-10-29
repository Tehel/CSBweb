/**
 * A recording's viewer's strip: the page's own, over the message area's top row while
 * `?recording=` plays (`playRecording`, `src/main.ts`; `doc/RECORDING.md` → "The port's
 * player"). From the left: four controls, which a click or a key works, pause, RESTART, stop and the pace
 * (×1, ×2, ×4, ×8), then the time played at the right edge. Space pauses, Backspace
 * restarts, Esc stops, and `+` and `-` change the pace.
 *
 * It is drawn in the menu's font and colours (`Widgets.ts`), a label lit under the
 * pointer, on CSBWin's screen as shown (`ScreenComposer.overlay`). The message area's
 * other three rows show the lines the recording prints, and the page's own: what was
 * skipped, and where it ends or drifts.
 *
 * RESTART plays the recording again from its start in the same page, the game and the
 * screen first put back as a new page has them (`rewindPage`), as the restart after a lost
 * game puts them back (`showEndOfGame`, `src/renderer/intro/EndOfGame.ts`).
 */
import { VBL_FREQUENCY } from '../../core/constants';
import type { Rect } from '../../data/tables/UITables';
import type { Game } from '../../engine/Game';
import type { ScrollingText } from '../csbwin/ScrollingText';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import type { GameScreen } from '../GameScreen';
import type { KeyPress } from '../GameInput';
import { MENU_OPTION_COLOR, MENU_PANEL_COLOR } from './Menu';
import { CHAR_WIDTH, LIT_COLOR, contains, drawText } from './Widgets';
import type { UIState } from './UIState';

/** The paces the viewer plays at: the loop's VBLs to a VBL of the wall clock (`Game.setPace`). */
export const PACES = [1, 2, 4, 8] as const;
export type Pace = (typeof PACES)[number];

/** What a control of the strip does. */
export type StripAction = 'pause' | 'pace' | 'restart' | 'stop';

/** What the strip shows: the VBLs played, whether it is paused, its pace, and the control under the pointer. */
export interface StripState {
  readonly vbls: number;
  readonly paused: boolean;
  readonly pace: Pace;
  readonly hover: StripAction | null;
}

/** The strip: the message area's top row, scanlines 172-178 (`ScrollingText`'s row 0). */
export const STRIP_RECT: Rect = { x1: 0, y1: 172, x2: 319, y2: 178 };
/** Its text's baseline, row 0's (`row*7 + 177`). */
const STRIP_BASELINE = 177;
/** Where the time played ends, its last character's cell: it is set flush right. */
const TIME_RIGHT = 316;

/** Each control's left edge, and the label it shows, in the strip's order from the left. */
const CONTROLS: ReadonlyArray<{ action: StripAction; x: number; label: (state: StripState) => string }> = [
  { action: 'pause', x: 4, label: (state) => (state.paused ? 'PLAY' : 'PAUSE') },
  { action: 'restart', x: 58, label: () => 'RESTART' },
  { action: 'stop', x: 124, label: () => 'STOP' },
  { action: 'pace', x: 172, label: (state) => `PACE X${state.pace}` },
];

/** The time played, `M:SS`, or `H:MM:SS` from an hour on: the VBLs over sixty. */
export function timePlayed(vbls: number): string {
  const seconds = Math.floor(vbls / VBL_FREQUENCY);
  const s = String(seconds % 60).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

/** A control's rectangle, its label's with a pixel around it, the strip's height. */
function controlRect(x: number, label: string): Rect {
  return { x1: x - 2, y1: STRIP_RECT.y1, x2: x + label.length * CHAR_WIDTH, y2: STRIP_RECT.y2 };
}

/** The strip drawn over the message area's top row. */
export function drawRecordingStrip(ui: UIState, state: StripState): void {
  fillRectIndex(ui.screenIndexBuffer, STRIP_RECT, MENU_PANEL_COLOR);
  const time = timePlayed(state.vbls);
  drawText(ui, time, TIME_RIGHT - time.length * CHAR_WIDTH, STRIP_BASELINE);
  for (const control of CONTROLS) {
    drawText(ui, control.label(state), control.x, STRIP_BASELINE, state.hover === control.action ? LIT_COLOR : MENU_OPTION_COLOR);
  }
}

/** The control at a point of the screen, or `null`. */
export function stripActionAt(state: StripState, x: number, y: number): StripAction | null {
  return CONTROLS.find((control) => contains(controlRect(control.x, control.label(state)), { x, y }))?.action ?? null;
}

/**
 * What a key does: a control's action, the pace one step up or down, or nothing (`null`).
 * Faster is the key that bears `+`, with or without Shift: `Equal`, `=` unshifted on a US
 * keyboard as on a French one, or the keypad's.
 */
export function stripKeyAction(press: KeyPress): StripAction | 'faster' | 'slower' | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  if (press.code === 'Space') return 'pause';
  if (press.code === 'Backspace') return 'restart';
  if (press.code === 'Escape') return 'stop';
  if (press.key === '+' || press.code === 'Equal' || press.code === 'NumpadAdd') return 'faster';
  if (press.key === '-' || press.code === 'NumpadSubtract') return 'slower';
  return null;
}

/** The pace after `pace`: one step `up` or down, held at either end, or the next round from ×8 to ×1 (`'round'`, a click's). */
export function nextPace(pace: Pace, step: 'up' | 'down' | 'round'): Pace {
  const at = PACES.indexOf(pace);
  if (step === 'round') return PACES[(at + 1) % PACES.length]!;
  return PACES[Math.max(0, Math.min(PACES.length - 1, at + (step === 'up' ? 1 : -1)))]!;
}

/**
 * The page put back as a new page has it before a recording plays again from its start
 * (RESTART): the loop stopped, the message area empty, the screen's play state its first
 * (`GameScreen.initializePlayState`), the loop's state a new loop's
 * (`Game.resumeMainLoop`), the clock running, which a path ended at a save the disk menu
 * made leaves held (`ctx.state.paused`), and `totalMoveCount` 0. That one is a global of CSBWin's, not
 * `d.`'s, which a new game's read counts on from (`Game.readNewGame`) and a saved game's
 * sets: a page reads a new game at its boot alone, so a recording that starts from one
 * starts from 0, and the file a join checks holds it. The caller then plays the path with
 * a new player, as the page began it.
 */
export function rewindPage(game: Game, screen: Pick<GameScreen, 'initializePlayState'>, messages: ScrollingText): void {
  game.stop();
  messages.clear();
  screen.initializePlayState();
  game.resumeMainLoop();
  game.ctx.state.paused = false;
  game.ctx.state.block1.totalMoveCount = 0;
}
