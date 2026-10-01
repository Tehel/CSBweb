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
 *        ├ _GameSetup(1) :10589
 *        │  ├ _TAG01f746 :9459             the entrance screen
 *        │  └ _ReadEntireGame               dungeon.dat, or the chosen save
 *        │     └ tag01efee                  a failed read
 *        └ _TAG021028    :10460            "GAME LOADED, READY TO PLAY." after a load
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
import type { SavedGameRead } from '../../engine/GameSaves';
import type { GameScreen } from '../GameScreen';
import { decodeCursorBitmap, type UIButton } from '../../data/tables/UITables';
import { MENU_PRESS_PHASE_MS, menuButtonRect, menuHitTest } from '../ui/Menu';
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
   * How the chooser's last read came out. The save screen owns the read; the entrance
   * screen only needs to know whether to put itself back up.
   */
  consumeSavedGameRead: () => SavedGameRead;
  /**
   * `_ReadEntireGame` for a new game: `dungeon.dat` read into the running game. False when
   * `ReadDatabases` fails (`doc/CSBwin-src/SaveGame.cpp:1740-1742`), which ends at
   * `tag01efee`; a file that will not open throws `Die` (`:1480-1486`).
   */
  readNewGame: () => Promise<boolean>;
  /** Skip the title animation and the entrance and boot straight into the dungeon. */
  skip: boolean;
  /** A line for the debug chrome's log: the boot's failure, before it enters anyway. */
  reportDebug: (message: string) => void;
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
    font: gameScreen.getFontData(),
    globalPalette,
    getGraphic: (graphicNum) => gameScreen.getBitmap(graphicNum),
    present: () => {
      const paint = (): void => gameScreen.presentScreen(globalPalette, host.palette11946 ?? null);
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
    takeClick: () => {
      const at = queue.findIndex((event) => event.kind === 'click');
      return at < 0 ? null : queue.splice(at, 1)[0];
    },
    discardAllInput: () => {
      queue = [];
      mouseSwitches = 0;
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
 * Anything but `'loaded'` makes `_GameSetup`'s retry loop put the entrance back up
 * (`doc/CSBwin-src/CSBCode.cpp:10634-10641`), `'damaged'` once `tag01efee` is done.
 *
 * A load closes the chooser once the save is read, which is after the click, so the wait
 * for input also ends when the chooser closes. What the chooser last showed stays on the
 * screen: `onRestoreSave` has drawn the adventure into the screen by then, which CSBWin
 * does not draw before `_TAG021028`.
 */
async function openLoadMenu(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead'>,
): Promise<SavedGameRead> {
  const { gameScreen } = deps;

  await fadeToPalette(host, PALETTE_11914);
  host.screen.pixels.fill(0);

  // `STShowCursor(HC33)` right before `SelectSaveGame` (`doc/CSBwin-src/SaveGame.cpp:1562`).
  host.setCursorVisible(true);
  let shown: Uint8Array | null = null;
  let chooserClosed: () => void = () => {};
  const closed = new Promise<null>((resolve) => { chooserClosed = () => resolve(null); });
  const draw = (): void => {
    if (gameScreen.isSaveMenuOpen()) {
      gameScreen.presentSaveMenuOnly(host.globalPalette);
      shown = host.screen.pixels.slice();
      return;
    }
    if (shown) host.screen.pixels.set(shown);
    host.present();
    chooserClosed();
  };
  gameScreen.setBootFrameRenderer(draw);
  // Forget a load made in play before the game was lost: only this chooser's read counts.
  deps.consumeSavedGameRead();
  gameScreen.openSaveMenu('loadOnly');
  draw();
  await fadeToPalette(host, palette11978(host));

  while (gameScreen.isSaveMenuOpen()) {
    const event = await Promise.race([host.nextEvent(), closed]);
    if (!event) break;
    if (event.kind === 'click') gameScreen.handleSaveMenuClick(event.x, event.y, event.buttons);
    else gameScreen.handleSaveMenuKey('Escape');
    draw();
  }

  gameScreen.setBootFrameRenderer(null);
  host.setCursorVisible(false);         // `STHideCursor(HC33)` (`SaveGame.cpp:1564`)
  return deps.consumeSavedGameRead();
}

/**
 * The chooser, then `tag01efee` if the read failed. `partyHasDied` is `d.PartyHasDied`:
 * false at the boot, true once the credits' RESTART THIS GAME has set it
 * (`doc/CSBwin-src/Mouse.cpp:1798`). Resolves to whether a save is in.
 */
async function readSavedGame(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead'>,
  partyHasDied: boolean,
): Promise<boolean> {
  const read = await openLoadMenu(host, deps);
  if (read === 'damaged') await tag01efee(host, deps.gameScreen, partyHasDied);
  return read === 'loaded';
}

/**
 * `_ReadEntireGame` once the entrance's doors have opened on a new game: `dungeon.dat`,
 * then `tag01efee` if the read failed, as a save's does. Resolves to whether the game is in.
 */
export async function readNewGame(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'readNewGame'> & { gameScreen: MenuScreen },
  partyHasDied: boolean,
): Promise<boolean> {
  if (await deps.readNewGame()) return true;
  await tag01efee(host, deps.gameScreen, partyHasDied);
  return false;
}

/** `_GameSetup`'s `ReadEntireGame` for the entrance's choice: `dungeon.dat` or a save. */
function readEntireGame(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead' | 'readNewGame'>,
  partyHasDied: boolean,
): (choice: PrisonDoorChoice) => Promise<boolean> {
  return (choice) => (choice === 'enter' ? readNewGame(host, deps, partyHasDied) : readSavedGame(host, deps, partyHasDied));
}

/**
 * What `die(0xbad)` stands for here: the boot's damaged file, acknowledged. `runBootSequence`
 * catches it and starts again from the title. CSBWin's `die` ends in `UI_Die`
 * (`doc/CSBwin-src/CSBCode.cpp:86-112`), which throws too (`CSBUI.cpp:1393-1396`), out to
 * the program's end.
 */
export class BadSavedGame extends Error {
  constructor() {
    super('SAVED GAME DAMAGED!');
  }
}

/**
 * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:86-112`): CSBWin's message box, then
 * the program's end. Nothing in the boot catches it; the page reports it where `init`
 * reports any error.
 */
export class Die extends Error {
  constructor(readonly errorNum: number, msg: string) {
    super(`System Error  0x${(errorNum >>> 0).toString(16).padStart(8, '0')}\n${msg}`);
  }
}

/**
 * `tag01efee`, where every failed read of `_ReadEntireGame` ends
 * (`doc/CSBwin-src/SaveGame.cpp:1895-1907`): a fade to `d.Palette11978`, then, after a
 * lost game, a one-button menu whose click goes back to `tag01ec56`, which returns -1 and
 * so puts the entrance up again (`:1556-1559`).
 *
 * At the boot CSBWin prints the line and calls `die(0xbad)`, which ends the program. A
 * page cannot end itself (`DEBT.md` H), so the line is a menu of its own with an OK to
 * acknowledge it, and the click throws `BadSavedGame`, back to the title.
 *
 * The "~" is CSBWin's own: this string goes to `DoMenu` without `SubstDiskLetter`.
 */
export async function tag01efee(host: IntroHost, menus: MenuScreen, partyHasDied: boolean): Promise<void> {
  await fadeToPalette(host, palette11978(host));
  if (partyHasDied) {
    await doMenuCentred(host, menus, 'SAVED GAME DAMAGED!', 'PUT THE CHAOS STRIKES BACK DISK IN ~', ['OK']);
  } else {
    await doMenuCentred(host, menus, 'SAVED GAME DAMAGED!', null, ['OK']);
  }
  host.setCursorVisible(true);          // `STShowCursor(HC33)` (`:1900`)
  await waitForMenuSelect(host, menus, 1);
  host.setCursorVisible(false);         // `STHideCursor(HC33)` (`:1902`)
  if (!partyHasDied) throw new BadSavedGame();
}

/**
 * `d.Palette11978`, the interface's palette: `_GameSetup` fills it from `d.Palette552[0]`
 * (`doc/CSBwin-src/CSBCode.cpp:10623`).
 */
function palette11978(host: IntroHost): readonly number[] {
  return host.uiTables.graphic232.palette552[0] ?? host.globalPalette;
}

/* ------------------------------------------------------------- the hand-off ---- */

/** What the boot's menus draw through: `GameScreen`'s share of `ui/Menu.ts`. */
export type MenuScreen = Pick<GameScreen, 'doMenu' | 'menuButtonList' | 'drawMenuPress'>;

/**
 * `_TAG021028`'s menu, when the game was loaded (`doc/CSBwin-src/CSBCode.cpp:10493-10537`):
 * both `_ShowPrisonDoor` (`:10677`) and the restart (`Code1f9e6.cpp:318`) call it once
 * `_GameSetup` has returned. The rest of `_TAG021028`, the adventure's state and its first
 * frame, is the page's.
 *
 * "ASCII DUMP" runs `AsciiDump`, which is unported (`DEBT.md` G14): here the button only
 * puts the menu up again, which is what the loop does after the dump.
 */
async function tag021028(host: IntroHost, gameScreen: GameScreen, choice: PrisonDoorChoice): Promise<void> {
  if (choice !== 'resume') return;
  for (;;) {
    await doMenuCentred(host, gameScreen, null, 'GAME LOADED, READY TO PLAY.', ['PLAY GAME', 'ASCII DUMP']);
    host.setCursorVisible(true);        // `STShowCursor(HC33)` (`:10510`)
    const selected = await waitForMenuSelect(host, gameScreen, 2);
    host.setCursorVisible(false);       // `STHideCursor(HC33)` (`:10512`)
    if (selected === 1) break;
  }
  await host.vbl(4);
  host.screen.pixels.fill(0);
  host.present();
}

/**
 * `_DoMenu` with `I1`, `ClearOldScreen` and `FadeOldScreen` all 1 (`doc/CSBwin-src/Menu.cpp:245`):
 * a fade to black, a cleared screen, the menu centred at (47, 33), and a fade up to
 * `d.Palette11978`. CSBWin draws the menu off screen first; here it goes into the screen
 * once it is black.
 */
async function doMenuCentred(
  host: IntroHost,
  gameScreen: MenuScreen,
  title1: string | null,
  title2: string | null,
  options: string[],
): Promise<void> {
  await fadeToPalette(host, PALETTE_11914);   // `:285-288`
  host.screen.pixels.fill(0);                 // `:289-292`
  gameScreen.doMenu(title1, title2, options, true);
  await fadeToPalette(host, palette11978(host)); // `:473-476`
}

/**
 * `_WaitForMenuSelect` over the centred button set (`doc/CSBwin-src/Menu.cpp:33`): wait for
 * a click on one of the menu's buttons, run the press animation, discard the input, and
 * return the 1-based choice. No key selects a button: CSBWin's one-button arm for Return
 * (`:82-93`) calls `NotImplemented`, which ends the program (`doc/PROVEN_FACTS.md` → "A
 * one-button menu takes no key").
 *
 * The press paints its two passes into the screen, the second over the first, and puts
 * back what it covered (`:100-180`).
 */
async function waitForMenuSelect(host: IntroHost, gameScreen: MenuScreen, numButton: number): Promise<number> {
  const buttons = gameScreen.menuButtonList(numButton, true);
  let choice = 0;
  while (choice === 0) {
    const event = await host.nextEvent();
    if (event.kind === 'click') choice = menuHitTest(buttons, event.x, event.y, event.buttons);
  }
  const rect = menuButtonRect(buttons, choice + 209);
  if (rect) {
    const press = { buttonId: choice + 209, rect, startedMs: 0 };
    host.setCursorVisible(false);       // `STHideCursor(HC41)` (`:107`)
    const saved = host.screen.pixels.slice();
    await host.vbl(1);
    gameScreen.drawMenuPress(press, 0);
    host.present();
    await host.vbl(5);
    gameScreen.drawMenuPress(press, MENU_PRESS_PHASE_MS);
    host.present();
    await host.vbl(5);
    host.screen.pixels.set(saved);
    host.present();
    host.setCursorVisible(true);        // `STShowCursor(HC41)` (`:180`)
  }
  host.discardAllInput();
  return choice;
}

/* ------------------------------------------------------------------- entry ---- */

/**
 * `d.Buttons16932`. Dungeon Master's `graphics.dat` stops 48 bytes short of carrying it,
 * and CSBWin patches in a hardcoded copy for exactly that case
 * (`doc/CSBwin-src/CSBCode.cpp:10148-10156`); `extractUITables` returns an empty list
 * under the same condition.
 */
function prisonDoorButtons(host: IntroHost): UIButton[] {
  const extracted = host.uiTables.graphic231.buttons.buttons16932;
  return extracted.length > 0 ? extracted : MISSING_PRISON_DOOR_BUTTONS;
}

/**
 * Play the title, show the entrance, and return how the player got in.
 *
 * With `skip` set there is no animation and no entrance — the dungeon starts fresh, which
 * is what every `tools/` script and the golden-frame probe want. Its read has no screen to
 * report a failure on, so a failed one throws.
 */
export async function runBootSequence(deps: BootSequenceDeps): Promise<PrisonDoorChoice> {
  if (deps.skip) return enterAnyway(deps);

  // The ST's colour registers as the boot ROM leaves them: black. Every screen here opens
  // with a fade, so the first thing the player sees is a fade up from this.
  const { host, detach } = createIntroHost(deps, PALETTE_11914);
  // What the boot has read so far, for the fallback below.
  let read: PrisonDoorChoice | null = null;
  const readGame = readEntireGame(host, deps, false);
  try {
    for (;;) {
      try {
        await displayChaosStrikesBack(host);
        const choice = await showPrisonDoor(host, prisonDoorButtons(host), async (c) => {
          if (!(await readGame(c))) return false;
          read = c;
          return true;
        });
        await tag021028(host, deps.gameScreen, choice);
        return choice;
      } catch (error) {
        if (!(error instanceof BadSavedGame)) throw error;
      }
    }
  } catch (error) {
    if (error instanceof Die) throw error;
    console.error('Boot sequence failed; entering the dungeon anyway', error);
    deps.reportDebug(`Intro failed: ${error}`);
    return read ?? enterAnyway(deps);
  } finally {
    detach();
  }
}

/** A new game read with no entrance to go back to: a failed read throws. */
async function enterAnyway(deps: Pick<BootSequenceDeps, 'readNewGame'>): Promise<PrisonDoorChoice> {
  if (!(await deps.readNewGame())) throw new Error('dungeon.dat: SAVED GAME DAMAGED!');
  return 'enter';
}

/* ------------------------------------------------------------- the end ---- */

/** How the end of a lost game comes out: a game set up again, or the credits left up. */
export type EndOfGame = PrisonDoorChoice | 'terminate';

/**
 * `_ShowCredits(1)` once `MainLoop` has returned on a lost game (`ShowCredits.ts`). The
 * page has stopped the adventure's input; this host takes the canvas from here. It keeps
 * it when the credits are where the game ends, and hands it back once a game is set up
 * again.
 *
 * The colour registers are the interface's: with `d.DynamicPaletteSwitching` set the VBL
 * copies `d.Palette11978` into `globalPalette` on every frame
 * (`doc/CSBwin-src/WinScreen.cpp:1493-1498`), and `_GameSetup` fills `Palette11978` from
 * `d.Palette552[0]` (`CSBCode.cpp:10623`).
 */
export async function runShowCredits(deps: Omit<BootSequenceDeps, 'skip' | 'reportDebug'>, hooks: ShowCreditsHooks): Promise<EndOfGame> {
  const uiTables = deps.gameScreen.getUITables();
  const palette11978 = uiTables.graphic232.palette552[0] ?? PALETTE_11914;
  const { host, detach } = createIntroHost(deps, palette11978);
  if ((await showCredits(host, hooks)) === 'terminate') return 'terminate';
  try {
    return await gameSetupAfterRestart(host, deps);
  } finally {
    detach();
  }
}

/**
 * `GameSetup(_25_, 0)` (`doc/CSBwin-src/Code1f9e6.cpp:310`, `CSBCode.cpp:10589`): no
 * entrance first. `d.Initialize()` has just left `d.gameState` at 0,
 * `GAMESTATE_ResumeSavedGame`, so its `ReadEntireGame` is the save chooser; a cancel puts
 * the entrance up, and the loop goes on from there as it does at boot (`:10634-10641`),
 * with `d.PartyHasDied` set, so a failed read of `dungeon.dat` or a save goes back to the
 * entrance too.
 */
async function gameSetupAfterRestart(host: IntroHost, deps: Omit<BootSequenceDeps, 'skip' | 'reportDebug'>): Promise<PrisonDoorChoice> {
  const readGame = readEntireGame(host, deps, true);
  const choice = (await readGame('resume')) ? 'resume' : await showPrisonDoor(host, prisonDoorButtons(host), readGame);
  await tag021028(host, deps.gameScreen, choice);
  return choice;
}
