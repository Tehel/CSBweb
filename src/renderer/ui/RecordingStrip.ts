/**
 * A recording's viewer's strip: the page's own, over the message area's top row while
 * `?recording=` plays (`playRecording`, `src/main.ts`; `doc/RECORDING.md` → "The port's
 * player"). From the left, its controls, which a click or a key works, each an icon on a
 * face of its own between darker columns, in three groups with black between them: eject
 * (Esc), which leaves for the welcome page; stop (Backspace), rewind, which does nothing
 * yet, play and pause (Space), a minute forward (→) and ten minutes forward (Shift+→);
 * slower (`-`), the pace, /4, /2, ×1, ×2, ×4 or ×8, which a click does not change, faster
 * (`+`), and loop (L), which plays the recording again from its start at its end. Then,
 * after black, flush right, the time played over the recording's length.
 *
 * It is drawn in the menu's font and colours (`Widgets.ts`), an icon lit under the
 * pointer, on CSBWin's screen as shown (`ScreenComposer.overlay`). The message area's
 * other three rows show the lines the recording prints, and the page's own: what was
 * skipped, and where it ends or drifts.
 *
 * Stop plays the recording again from its start in the same page, the game and the
 * screen first put back as a new page has them (`rewindPage`), as the restart after a lost
 * game puts them back (`showEndOfGame`, `src/renderer/intro/EndOfGame.ts`), and pauses it
 * at its first tick.
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
export const PACES = [0.25, 0.5, 1, 2, 4, 8] as const;
export type Pace = (typeof PACES)[number];

/** The VBLs forward runs at once: a minute of the game's, or ten (`forward10`). */
export const FORWARD_VBLS = { forward: 60 * VBL_FREQUENCY, forward10: 600 * VBL_FREQUENCY } as const;

/** What a control of the strip does. */
export type StripAction = 'eject' | 'stop' | 'rewind' | 'play' | 'forward' | 'forward10' | 'slower' | 'faster' | 'loop';
/** A face of the strip: a control's, or the pace's, which only shows it. */
type Face = StripAction | 'pace';

/**
 * What the strip shows: the VBLs played and the recording's, whether it is paused or has
 * ended, its pace, whether it loops, and the control under the pointer.
 */
export interface StripState {
  readonly vbls: number;
  readonly length: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly pace: Pace;
  readonly loop: boolean;
  readonly hover: StripAction | null;
}

/** The strip: the message area's top row, scanlines 172-178 (`ScrollingText`'s row 0). */
export const STRIP_RECT: Rect = { x1: 0, y1: 172, x2: 319, y2: 178 };
/** Its text's baseline, row 0's (`row*7 + 177`), and the icons' top, the text's: both five rows high. */
const STRIP_BASELINE = 177;
const ICON_TOP = 173;
/** Where the time ends, its last character's cell: it is set flush right. */
const TIME_RIGHT = 316;
/** The UI palette's `0310`, darker than the panel's `0420`: the columns between the faces, an inactive icon, and loop's face while it loops. */
const DARK_COLOR = 3;
/** The UI palette's `0000`: the gaps between the groups, the message area's own black. */
const GAP_COLOR = 0;

/** A face's width, the darker column's between two, and the black gap's after a group. */
const FACE_WIDTH = 16;
const COLUMN_WIDTH = 2;
const GROUP_GAP = 8;
/** The faces in their groups, from the left. */
const GROUPS: ReadonlyArray<readonly Face[]> = [
  ['eject'], ['stop', 'rewind', 'play', 'forward', 'forward10'], ['slower', 'pace', 'faster', 'loop'],
];

/** Each face, the strip's height, a darker column on either side of it. */
const FACES: ReadonlyArray<{ face: Face; rect: Rect }> = (() => {
  const faces: { face: Face; rect: Rect }[] = [];
  let x = 0;
  for (const group of GROUPS) {
    x += COLUMN_WIDTH;
    for (const face of group) {
      faces.push({ face, rect: { x1: x, y1: STRIP_RECT.y1, x2: x + FACE_WIDTH - 1, y2: STRIP_RECT.y2 } });
      x += FACE_WIDTH + COLUMN_WIDTH;
    }
    x += GROUP_GAP;
  }
  return faces;
})();
/** The black gaps after each group, the last one's before the time's panel. */
const GAPS: readonly Rect[] = (() => {
  const gaps: Rect[] = [];
  let x = 0;
  for (const group of GROUPS) {
    x += COLUMN_WIDTH + group.length * (FACE_WIDTH + COLUMN_WIDTH);
    gaps.push({ x1: x, y1: STRIP_RECT.y1, x2: x + GROUP_GAP - 1, y2: STRIP_RECT.y2 });
    x += GROUP_GAP;
  }
  return gaps;
})();

/** The icons, five rows each, `#` drawn. */
const ICONS = {
  eject: ['..#..', '.###.', '#####', '.....', '#####'],
  stop: ['#####', '#####', '#####', '#####', '#####'],
  rewind: ['..#..#', '.##.##', '######', '.##.##', '..#..#'],
  play: ['#...', '###.', '####', '###.', '#...'],
  pause: ['##.##', '##.##', '##.##', '##.##', '##.##'],
  forward: ['#..#..', '##.##.', '######', '##.##.', '#..#..'],
  forward10: ['#..#..#..', '##.##.##.', '#########', '##.##.##.', '#..#..#..'],
  slower: ['.....', '.....', '#####', '.....', '.....'],
  faster: ['..#..', '..#..', '#####', '..#..', '..#..'],
  loop: ['.#.....', '#######', '#.....#', '#######', '.....#.'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Whether a control does something now: rewind is not yet, forward only while the
 * recording plays, and slower and faster short of the slowest and the fastest pace.
 */
function enabled(action: StripAction, state: StripState): boolean {
  if (action === 'rewind') return false;
  if (action === 'forward' || action === 'forward10') return !state.ended;
  if (action === 'slower') return state.pace !== PACES[0];
  if (action === 'faster') return state.pace !== PACES[PACES.length - 1];
  return true;
}

/** The pace as the strip shows it: `/4`, `/2`, then `X1` to `X8`. */
function paceLabel(pace: Pace): string {
  return pace < 1 ? `/${1 / pace}` : `X${pace}`;
}

/** The time played, `M:SS`, or `H:MM:SS` from an hour on: the VBLs over sixty. */
export function timePlayed(vbls: number): string {
  const seconds = Math.floor(vbls / VBL_FREQUENCY);
  const s = String(seconds % 60).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

/** An icon drawn in `color`, centred across `face`. */
function drawIcon(ui: UIState, icon: readonly string[], face: Rect, color: number): void {
  const { pixels, width } = ui.screenIndexBuffer;
  const x = face.x1 + Math.floor((FACE_WIDTH - icon[0]!.length) / 2);
  icon.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] === '#') pixels[(ICON_TOP + dy) * width + x + dx] = color;
  });
}

/** The strip drawn over the message area's top row. */
export function drawRecordingStrip(ui: UIState, state: StripState): void {
  fillRectIndex(ui.screenIndexBuffer, STRIP_RECT, MENU_PANEL_COLOR);
  for (const gap of GAPS) fillRectIndex(ui.screenIndexBuffer, gap, GAP_COLOR);
  for (const { face, rect } of FACES) {
    fillRectIndex(ui.screenIndexBuffer, { ...rect, x1: rect.x1 - COLUMN_WIDTH, x2: rect.x1 - 1 }, DARK_COLOR);
    fillRectIndex(ui.screenIndexBuffer, { ...rect, x1: rect.x2 + 1, x2: rect.x2 + COLUMN_WIDTH }, DARK_COLOR);
    const background = face === 'loop' && state.loop ? DARK_COLOR : MENU_PANEL_COLOR;
    fillRectIndex(ui.screenIndexBuffer, rect, background);
    if (face === 'pace') {
      const label = paceLabel(state.pace);
      drawText(ui, label, rect.x1 + Math.floor((FACE_WIDTH - label.length * CHAR_WIDTH + 1) / 2), STRIP_BASELINE, MENU_OPTION_COLOR, background);
      continue;
    }
    const color = !enabled(face, state) ? DARK_COLOR : state.hover === face ? LIT_COLOR : MENU_OPTION_COLOR;
    const icon = face === 'play' ? (state.paused || state.ended ? ICONS.play : ICONS.pause) : ICONS[face];
    drawIcon(ui, icon, rect, color);
  }
  const time = `${timePlayed(state.vbls)} / ${timePlayed(state.length)}`;
  drawText(ui, time, TIME_RIGHT - time.length * CHAR_WIDTH, STRIP_BASELINE);
}

/** The control at a point of the screen, or `null`, an inactive one's too, and the pace's. */
export function stripActionAt(state: StripState, x: number, y: number): StripAction | null {
  const face = FACES.find(({ rect }) => contains(rect, { x, y }))?.face;
  return face && face !== 'pace' && enabled(face, state) ? face : null;
}

/**
 * What a key does: an active control's action, or nothing (`null`). Faster is the key
 * that bears `+`, with or without Shift: `Equal`, `=` unshifted on a US keyboard as on a
 * French one, or the keypad's.
 */
export function stripKeyAction(press: KeyPress, state: StripState): StripAction | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  const action = keyAction(press);
  return action !== null && enabled(action, state) ? action : null;
}

function keyAction(press: KeyPress): StripAction | null {
  if (press.code === 'Space') return 'play';
  if (press.code === 'Backspace') return 'stop';
  if (press.code === 'Escape') return 'eject';
  if (press.code === 'ArrowRight') return press.shiftKey ? 'forward10' : 'forward';
  if (press.code === 'ArrowLeft') return 'rewind';
  if (press.code === 'KeyL') return 'loop';
  if (press.key === '+' || press.code === 'Equal' || press.code === 'NumpadAdd') return 'faster';
  if (press.key === '-' || press.code === 'NumpadSubtract') return 'slower';
  return null;
}

/** The pace one step `up` or down from `pace`, held at either end. */
export function nextPace(pace: Pace, step: 'up' | 'down'): Pace {
  const at = PACES.indexOf(pace);
  return PACES[Math.max(0, Math.min(PACES.length - 1, at + (step === 'up' ? 1 : -1)))]!;
}

/**
 * The page put back as a new page has it before a recording plays again from its start
 * (stop): the loop stopped, the message area empty, the screen's play state its first
 * (`GameScreen.initializePlayState`), the loop's state a new loop's
 * (`Game.resumeMainLoop`), the clock running, which a path ended at a save the disk menu
 * made leaves held (`ctx.state.paused`), and `totalMoveCount` 0, a global of CSBWin's,
 * not `d.`'s, which a new game's read counts on from (`Game.readNewGame`) until the
 * player sets the recording's own (`RecordingStart`). The caller then plays the path with
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
