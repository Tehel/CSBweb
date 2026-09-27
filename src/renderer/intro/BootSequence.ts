/**
 * Everything that happens before the party is in the dungeon.
 *
 * CSBWin's shape, from `UIM_INITIALIZE` (`doc/CSBwin-src/CSBUI.cpp:907`) down:
 *
 * ```
 * _AskWhatToDo          CSBCode.cpp:11338
 *  ├ _DisplayChaosStrikesBack  :9203      the title animation
 *  ├ DoMenu QUIT/DUNGEON/UTILITY/HINT     not ported: this program is only the dungeon
 *  └ _StartCSB           :11290
 *     └ _ShowPrisonDoor  :10656
 *        └ _GameSetup(1) :10589
 *           ├ _TAG01f746 :9459             the entrance screen
 *           └ _ReadEntireGame               dungeon.dat, or the chosen save
 * ```
 *
 * This module is the two ends of that: it builds the `IntroHost` the screens draw through —
 * the screen buffer, the colour registers, the VBL clock, the sound and the input queue —
 * and it runs `displayChaosStrikesBack` then `showPrisonDoor`. The screens themselves are
 * `TitleSequence.ts` and `PrisonDoor.ts`.
 *
 * The launcher menu is deliberately absent. CSBWin needs it because one binary runs the
 * dungeon, the utility and the hint oracle; this one runs the dungeon.
 */
import { updateDebug } from '../../ui';
import type { GameScreen } from '../GameScreen';
import { decodeCursorBitmap } from '../csbwin/UITables';
import { fadeToPalette, PALETTE_11914, withCursor, type IntroEvent, type IntroHost } from './IntroHost';
import { MISSING_PRISON_DOOR_BUTTONS, showPrisonDoor, type PrisonDoorChoice } from './PrisonDoor';
import { showCredits, type ShowCreditsHooks } from './ShowCredits';
import { displayChaosStrikesBack } from './TitleSequence';

/** 60 Hz. `wvbl()` is one of these; `VBLDelay(n)` is n. */
const VBL_MS = 1000 / 60;

export interface BootSequenceDeps {
  canvas: HTMLCanvasElement;
  gameScreen: GameScreen;
  /** `StartSound` — see `timerDataToRateIndex` for where the rate index comes from. */
  playSound?: (soundId: number, rateIdx?: number) => void;
  /**
   * Whether the last `onRestoreSave` actually restored something. The save screen owns the
   * decision; the entrance screen only needs to know whether to put itself back up.
   */
  consumeRestored: () => boolean;
  /** Skip the title animation and the entrance and boot straight into the dungeon. */
  skip: boolean;
}

/* ----------------------------------------------------------------- the host ---- */

interface AttachedHost {
  host: IntroHost;
  detach: () => void;
}

/** What a host needs from the page: `BootSequenceDeps` without the boot's own decisions. */
type HostDeps = Pick<BootSequenceDeps, 'canvas' | 'gameScreen' | 'playSound'>;

/** `palette` is the shifter's colour registers as the host finds them. */
function createIntroHost(deps: HostDeps, palette: readonly number[]): AttachedHost {
  const { canvas, gameScreen } = deps;
  const screen = gameScreen.getScreenBuffer();
  const uiTables = gameScreen.getUITables();
  if (!uiTables) throw new Error('Screen not initialized');
  const globalPalette = [...palette];

  let queue: IntroEvent[] = [];
  let waiting: ((event: IntroEvent) => void) | null = null;
  // `d.Byte1222`, the arrow. The hand (`d.Byte1350`) only ever appears with an object on
  // the cursor (`d.CursorShape != 0`, `doc/CSBwin-src/CSBCode.cpp:2255`), which cannot
  // happen before there is a party.
  const arrow = decodeCursorBitmap(uiTables.graphic232.cursorArrow);
  let cursorVisible = false;
  let pointerX = -100;
  let pointerY = -100;
  // `d.MouseSwitches`: set on a press, cleared on any release (`doc/CSBwin-src/system.cpp:455-461`,
  // `CSBCode.cpp:7585`).
  let mouseSwitches = 0;

  const push = (event: IntroEvent): void => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(event);
    } else {
      queue.push(event);
    }
  };

  // CSBWin's mask: 2 = left, 1 = right (`doc/CSBwin-src/CSB.h:1659-1667`).
  const pointAt = (e: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) * canvas.width) / rect.width),
      y: Math.floor(((e.clientY - rect.top) * canvas.height) / rect.height),
    };
  };
  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = pointAt(e);
    pointerX = x;
    pointerY = y;
    const buttons = e.button === 2 ? 1 : e.button === 0 ? 2 : 0;
    if (buttons === 0) return;
    mouseSwitches = buttons;
    push({ kind: 'click', x, y, buttons });
  };
  const onMouseUp = (): void => {
    mouseSwitches = 0;
  };
  // The screens between animations are static, so nothing would repaint and the arrow
  // would sit where it was drawn. CSBWin has the VBL handler for this; here the move is
  // the repaint.
  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = pointAt(e);
    if (x === pointerX && y === pointerY) return;
    pointerX = x;
    pointerY = y;
    if (cursorVisible) host.present();
  };
  const onMouseLeave = (): void => {
    pointerX = -100;
    pointerY = -100;
    if (cursorVisible) host.present();
  };
  const onContextMenu = (e: Event): void => e.preventDefault();
  const onKeyDown = (): void => push({ kind: 'key', x: 0, y: 0, buttons: 0 });

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  const host: IntroHost = {
    screen,
    uiTables,
    globalPalette,
    getGraphic: (graphicNum) => gameScreen.getBitmap(graphicNum),
    present: () => {
      const paint = (): void => gameScreen.presentScreen(globalPalette);
      if (!cursorVisible) paint();
      else withCursor(screen, arrow, pointerX, pointerY, paint);
    },
    vbl: (count) =>
      new Promise<void>((resolve) => {
        // Wall-clock rather than one resolve per animation frame: a 120 Hz display would
        // otherwise run every animation here at double speed.
        const deadline = performance.now() + count * VBL_MS;
        const tick = (): void => {
          if (performance.now() >= deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    startSound: (graphicNum, rateIdx) => deps.playSound?.(graphicNum, rateIdx),
    drawPrisonInterior: () => gameScreen.renderPrisonInterior(),
    nextEvent: () =>
      new Promise<IntroEvent>((resolve) => {
        const queued = queue.shift();
        if (queued) resolve(queued);
        else waiting = resolve;
      }),
    discardAllInput: () => {
      queue = [];
    },
    mouseSwitches: () => mouseSwitches,
    keyWaiting: () => queue.some((event) => event.kind === 'key'),
    setCursorVisible: (visible) => {
      if (visible === cursorVisible) return;
      cursorVisible = visible;
      host.present();
    },
  };

  return {
    host,
    detach: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      queue = [];
      waiting = null;
    },
  };
}

/* ------------------------------------------------------------------ Resume ---- */

/**
 * Button 201: the save/load screen, with no SAVE.
 *
 * `_ReadEntireGame` goes straight to the file chooser on this path — no "READY TO SAVE
 * GAME" menu first — and passes `SelectSaveGame(_9_, 1, 1, 1)`
 * (`doc/CSBwin-src/SaveGame.cpp:1563`). The leading 1 is `_DoMenu`'s "fade and clear the
 * old screen", so the chooser comes up on black rather than over the entrance, and the
 * `checkExist` 1 blanks slots with no file behind them — which is exactly what this port's
 * `loadOnly` mode already does with an unbounded list (`ui/SaveMenu.ts`).
 *
 * Cancelling returns false, and `_GameSetup`'s retry loop puts the entrance back up
 * (`doc/CSBwin-src/CSBCode.cpp:10634-10641`).
 */
async function openLoadMenu(host: IntroHost, deps: BootSequenceDeps): Promise<boolean> {
  const { gameScreen } = deps;
  const menuPalette = host.uiTables.graphic232.palette552[0] ?? host.globalPalette;

  await fadeToPalette(host, PALETTE_11914);
  host.screen.pixels.fill(0);

  // `STShowCursor(HC33)` right before `SelectSaveGame` (`doc/CSBwin-src/SaveGame.cpp:1562`).
  host.setCursorVisible(true);
  const draw = (): void => gameScreen.presentSaveMenuOnly(host.globalPalette);
  gameScreen.setBootFrameRenderer(draw);
  gameScreen.openSaveMenu('loadOnly');
  draw();
  await fadeToPalette(host, menuPalette);

  while (gameScreen.isSaveMenuOpen()) {
    const event = await host.nextEvent();
    if (event.kind === 'click') gameScreen.handleSaveMenuClick(event.x, event.y, event.buttons);
    else gameScreen.handleSaveMenuKey('Escape');
    draw();
  }

  gameScreen.setBootFrameRenderer(null);
  return deps.consumeRestored();
}

/* ------------------------------------------------------------------- entry ---- */

/**
 * Play the title, show the entrance, and return how the player got in.
 *
 * With `skip` set there is no animation and no entrance — the dungeon starts fresh, which
 * is what every `tools/` script and the golden-frame probe want.
 */
export async function runBootSequence(deps: BootSequenceDeps): Promise<PrisonDoorChoice> {
  if (deps.skip) return 'enter';

  // The ST's colour registers as the boot ROM leaves them: black. Every screen here opens
  // with a fade, so the first thing the player sees is a fade up from this.
  const { host, detach } = createIntroHost(deps, PALETTE_11914);
  try {
    await displayChaosStrikesBack(host);

    // `d.Buttons16932`. Dungeon Master's `graphics.dat` stops 48 bytes short of carrying
    // it, and CSBWin patches in a hardcoded copy for exactly that case
    // (`doc/CSBwin-src/CSBCode.cpp:10148-10156`); `extractUITables` returns an empty list
    // under the same condition.
    const extracted = host.uiTables.graphic231.buttons.buttons16932;
    const buttons = extracted.length > 0 ? extracted : MISSING_PRISON_DOOR_BUTTONS;

    return await showPrisonDoor(host, buttons, () => openLoadMenu(host, deps));
  } catch (error) {
    console.error('Boot sequence failed; entering the dungeon anyway', error);
    updateDebug(`Intro failed: ${error}`);
    return 'enter';
  } finally {
    detach();
  }
}

/* ------------------------------------------------------------- the end ---- */

/**
 * `_ShowCredits(1)` once `MainLoop` has returned on a lost game (`ShowCredits.ts`). The
 * page has stopped the adventure's input; this host takes the canvas from here, and keeps
 * it, since the credits are where the game ends.
 *
 * The colour registers are the interface's: with `d.DynamicPaletteSwitching` set the VBL
 * copies `d.Palette11978` into `globalPalette` on every frame
 * (`doc/CSBwin-src/WinScreen.cpp:1493-1498`), and `_GameSetup` fills `Palette11978` from
 * `d.Palette552[0]` (`CSBCode.cpp:10623`).
 */
export async function runShowCredits(deps: HostDeps, hooks: ShowCreditsHooks): Promise<void> {
  const uiTables = deps.gameScreen.getUITables();
  if (!uiTables) throw new Error('Screen not initialized');
  const palette11978 = uiTables.graphic232.palette552[0] ?? PALETTE_11914;
  const { host } = createIntroHost(deps, palette11978);
  await showCredits(host, hooks);
}
