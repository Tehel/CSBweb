/**
 * Everything that happens before the party is in the dungeon.
 *
 * CSBWin's shape, from `UIM_INITIALIZE` (`doc/CSBwin-src/CSBUI.cpp:928`) down:
 *
 * ```
 * _AskWhatToDo          CSBCode.cpp:11573
 *  ├ _DisplayChaosStrikesBack  :9308      the title animation
 *  ├ DoMenu QUIT/DUNGEON/UTILITY/HINT     not ported: this program is only the dungeon
 *  └ _StartCSB           :11525
 *     └ _ShowPrisonDoor  :10780
 *        ├ _GameSetup(1) :10713
 *        │  ├ _TAG01f746 :9577             the entrance screen
 *        │  └ _ReadEntireGame               dungeon.dat, or the chosen save
 *        │     └ tag01efee                  a failed read
 *        └ _TAG021028    :10584            the hand-off to the adventure
 * ```
 *
 * This module is the two ends of that: it builds the `IntroHost` the screens draw through —
 * the screen buffer, the colour registers, the VBL clock, the sound and the input queue —
 * and it runs `displayChaosStrikesBack` then `showPrisonDoor`. The screens themselves are
 * `TitleSequence.ts` and `PrisonDoor.ts`; a set's thumbnail may stand in the animation's
 * place (`TitlePicture.ts`), which CSBWin never shows. Before them, the Atari ST disk's
 * FTL logo (`Swoosh.ts`), which is not CSBWin's (`DEBT.md` H).
 *
 * The launcher menu is deliberately absent. CSBWin needs it because one binary runs the
 * dungeon, the utility and the hint oracle; this one runs the dungeon.
 */
import type { Swoosh } from '../../data/SwooshLoader';
import { readHintOracle } from '../../data/HintOracleLoader';
import type { HintOracleFiles } from '../ui/HintOracleButton';
import { Die } from '../../core/Die';
import type { MessageSink } from '../../engine/GameHost';
import type { SavedGameRead } from '../../engine/GameSaves';
import type { GameInput, InputOwner } from '../GameInput';
import type { GameScreen } from '../GameScreen';
import type { UIState } from '../ui/UIState';
import { isDialogOpen } from '../ui/Dialog';
import { isSaveMenuOpen, openSaveMenu } from '../ui/SaveMenu';
import { decodeCursorBitmap, type UIButton } from '../../data/tables/UITables';
import { MENU_PRESS_PHASE_MS, doMenu, drawMenuPress, menuButtonList, menuButtonRect, menuHitTest, type MenuPress } from '../ui/Menu';
import { HintOracleScreen, type HintSquare } from './HintOracle';
import { fadeToPalette, PALETTE_11914, withCursor, type IntroEvent, type IntroHost } from './IntroHost';
import { MISSING_PRISON_DOOR_BUTTONS, showPrisonDoor, type PrisonDoorChoice } from './PrisonDoor';
import { showCredits, type ShowCreditsHooks } from './ShowCredits';
import { showSwoosh } from './Swoosh';
import { displayChaosStrikesBack } from './TitleSequence';
import { showTitlePicture } from './TitlePicture';
import type { TitleFrame } from './TitleThumbnail';

/** 60 Hz. `wvbl()` is one of these; `VBLDelay(n)` is n. */
const VBL_MS = 1000 / 60;

export interface BootSequenceDeps {
  /** The page's input (`src/ui/events.ts`), which a host holds while its screens have the canvas. */
  input: Pick<GameInput, 'take'>;
  gameScreen: GameScreen;
  /** `StartSound` — see `timerDataToRateIndex` for where the rate index comes from. */
  playSound?: (soundId: number, rateIdx?: number) => void;
  /**
   * How the chooser's last read came out. The save screen owns the read; the entrance
   * screen only needs to know whether to put itself back up.
   */
  consumeSavedGameRead: () => SavedGameRead;
  /**
   * `_ReadEntireGame` for a new game: `dungeon.dat` read into the running game. A file
   * that will not open (`doc/CSBwin-src/SaveGame.cpp:1579-1586`), or does not read
   * (`:1910-1912`, the author's decision), throws `Die`.
   */
  readNewGame: () => Promise<void>;
  /**
   * Whether the entrance has RISE (`src/renderer/intro/PrisonDoor.ts`): the data set
   * has a `mini.dat` to make a new adventure in.
   */
  rise: boolean;
  /** Whether the set is the Amiga's, its `graphics.dat` carrying the table item: the entrance's doors open on A22E's timing. */
  amiga: boolean;
  /**
   * The FTL logo to show before the title, with its sound, when `swoosh.img` is served.
   * Absent, the boot is CSBWin's.
   */
  swoosh?: { image: Swoosh; startSound: () => void } | null;
  /**
   * Whether the title animation plays before the entrance: the player's startup
   * animations (`src/settings/Settings.ts`). Off, the entrance is the first screen.
   */
  title: boolean;
  /**
   * The data set's thumbnail, reduced to the screen's sixteen registers, to show in the
   * animation's place (`TitlePicture.ts`), where its author asked for it
   * (`DataSet.thumbnailAsTitle`). Absent, the animation plays.
   */
  titlePicture?: TitleFrame | null;
  /** Skip the logo, the title animation and the entrance and boot straight into the dungeon. */
  skip: boolean;
}

/* ----------------------------------------------------------------- the host ---- */

interface AttachedHost {
  host: IntroHost;
  detach: () => void;
}

/**
 * The pre-game screens as the probes read them (`tools/probe-frames.ts`, through
 * `window.__probe.intro`): the VBLs the host has waited, whether a screen waits for a click
 * or a key (`nextEvent`), and the Hint Oracle while it is up, whose wait for a button is
 * its own (`HintOracleScreen.waiting`). Nothing of the game reads it.
 */
export const introProbe: { vbls: number; waiting: boolean; oracle: { readonly waiting: boolean } | null } = {
  vbls: 0, waiting: false, oracle: null,
};

/** What a host needs from the page: `BootSequenceDeps` without the boot's own decisions. */
type HostDeps = Pick<BootSequenceDeps, 'input' | 'gameScreen' | 'playSound'>;

/**
 * `palette` is the shifter's colour registers as the host finds them. The host holds the
 * page's input until it is detached (`GameInput.take`). Its screens take a key a dialog
 * of theirs reads from the browser, or every key but a browser shortcut where `ownsKeys`.
 */
function createIntroHost(deps: HostDeps, palette: readonly number[], ownsKeys = false): AttachedHost {
  const { gameScreen } = deps;
  const { composer, ui } = gameScreen;
  const screen = composer.screen;
  const uiTables = ui.uiTables;
  const globalPalette = [...palette];

  let queue: IntroEvent[] = [];
  let waiting: ((event: IntroEvent) => void) | null = null;
  // `d.Byte1222`, the arrow. The hand (`d.Byte1350`) only ever appears with an object on
  // the cursor (`d.CursorShape != 0`, `doc/CSBwin-src/CSBCode.cpp:2288`), which cannot
  // happen before there is a party.
  const arrow = decodeCursorBitmap(uiTables.graphic232.cursorArrow);
  let cursorVisible = false;
  let pointerX = -100;
  let pointerY = -100;
  // `d.MouseSwitches`: set on a press, cleared on any release (`doc/CSBwin-src/system.cpp:455-461`,
  // `CSBCode.cpp:7644`).
  let mouseSwitches = 0;

  const push = (event: IntroEvent): void => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      introProbe.waiting = false;
      resolve(event);
    } else {
      queue.push(event);
    }
  };

  // The page's points of the canvas, as play has them (`src/ui/events.ts`): through the CRT
  // effect's curve where it is on, only the primary pointer's, and a finger's lift is not
  // the pointer leaving.
  const owner: InputOwner = {
    mouseDown: (x, y, button) => {
      pointerX = x;
      pointerY = y;
      // CSBWin's mask: 2 = left, 1 = right (`doc/CSBwin-src/CSB.h:1662-1670`).
      const buttons = button === 2 ? 1 : button === 0 ? 2 : 0;
      if (buttons === 0) return;
      mouseSwitches = buttons;
      push({ kind: 'click', x, y, buttons });
    },
    mouseUp: () => {
      mouseSwitches = 0;
    },
    // The screens between animations are static, so nothing would repaint and the arrow
    // would sit where it was drawn. CSBWin has the VBL handler for this; here the move is
    // the repaint.
    mouseMove: (x, y) => {
      if (x === pointerX && y === pointerY) return;
      pointerX = x;
      pointerY = y;
      // The chooser's import hint follows the pointer; a redraw for it presents the screen.
      if (isDialogOpen(ui) && gameScreen.moveDialogPointer({ x, y })) return;
      if (cursorVisible) host.present();
    },
    mouseLeave: () => {
      pointerX = -100;
      pointerY = -100;
      if (isDialogOpen(ui) && gameScreen.moveDialogPointer(null)) return;
      if (cursorVisible) host.present();
    },
    // The wheel is the chooser's list's, as it is the disk menu's in play
    // (`GameInput.wheel`), and no other pre-game screen's. It is no event of the queue,
    // where a screen waiting for a click or a key would take it for one.
    wheel: (deltaY) => {
      if (!isDialogOpen(ui)) return false;
      gameScreen.handleDialogWheel(deltaY);
      return true;
    },
    // The chooser's keys are its own, as the disk menu's are in play: an arrow moves its
    // selection, and does not scroll the page as well.
    keyDown: (press) => {
      const key = press.ctrlKey || press.metaKey || press.altKey ? '' : press.key;
      const taken = key !== '' && (ownsKeys || isDialogOpen(ui));
      push({ kind: 'key', x: 0, y: 0, buttons: 0, key, code: key ? press.code : '' });
      return taken;
    },
  };
  const release = deps.input.take(owner);

  const host: IntroHost = {
    screen,
    uiTables,
    font: ui.fontData,
    globalPalette,
    getGraphic: (graphicNum) => composer.getBitmap(graphicNum),
    present: () => {
      const paint = (): void => composer.presentScreen(globalPalette, host.palette11946 ?? null);
      if (!cursorVisible) paint();
      else withCursor(screen, arrow, pointerX, pointerY, paint);
    },
    vbl: (count) =>
      new Promise<void>((resolve) => {
        // Wall-clock rather than one resolve per animation frame: a 120 Hz display would
        // otherwise run every animation here at double speed. The frames are the page's
        // animation clock's (`Presenter.frames`).
        const deadline = performance.now() + count * VBL_MS;
        gameScreen.presenter.frames(() => {
          if (performance.now() < deadline) return true;
          introProbe.vbls += count;
          resolve();
          return false;
        });
      }),
    startSound: (graphicNum, rateIdx) => deps.playSound?.(graphicNum, rateIdx),
    drawPrisonInterior: () => gameScreen.renderPrisonInterior(),
    nextEvent: () =>
      new Promise<IntroEvent>((resolve) => {
        const queued = queue.shift();
        if (queued) {
          resolve(queued);
          return;
        }
        waiting = resolve;
        introProbe.waiting = true;
      }),
    takeClick: () => {
      const at = queue.findIndex((event) => event.kind === 'click');
      return at < 0 ? null : queue.splice(at, 1)[0]!;
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
      release();
      queue = [];
      waiting = null;
      introProbe.waiting = false;
    },
  };
}

/* ------------------------------------------------------------------ Resume ---- */

/**
 * Button 201: the save/load screen, with no SAVE.
 *
 * `_ReadEntireGame` goes straight to the file chooser on this path — no "READY TO SAVE
 * GAME" menu first — and passes `SelectSaveGame(_9_, 1, 1, 1)`
 * (`doc/CSBwin-src/SaveGame.cpp:1688`). The leading 1 is `_DoMenu`'s "fade and clear the
 * old screen", so the chooser comes up on black rather than over the entrance, and the
 * `checkExist` 1 blanks slots with no file behind them — which is exactly what this port's
 * `loadOnly` mode already does with an unbounded list (`ui/SaveMenu.ts`).
 *
 * Anything but `'loaded'` makes `_GameSetup`'s retry loop put the entrance back up
 * (`doc/CSBwin-src/CSBCode.cpp:10758-10765`), `'damaged'` once `tag01efee` is done.
 *
 * A load closes the chooser once the save is read, which is after the click, so the wait
 * for input also ends when the chooser closes. What the chooser last showed stays on the
 * screen for `tag021028`'s fade: `onRestoreSave` has drawn the adventure into the screen
 * by then, which CSBWin does not draw before `_TAG021028`.
 */
async function openLoadMenu(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead'>,
  mode: 'loadOnly' | 'rise' = 'loadOnly',
): Promise<SavedGameRead> {
  const { gameScreen } = deps;
  const { composer, ui } = gameScreen;

  await fadeToPalette(host, PALETTE_11914);
  host.screen.pixels.fill(0);

  // `STShowCursor(HC33)` right before `SelectSaveGame` (`doc/CSBwin-src/SaveGame.cpp:1687`).
  host.setCursorVisible(true);
  let shown: Uint8Array | null = null;
  let chooserClosed: () => void = () => {};
  const closed = new Promise<null>((resolve) => { chooserClosed = () => resolve(null); });
  // Every redraw is presented with the cursor on it, which stays up from `STShowCursor` to
  // `STHideCursor` (`SaveGame.cpp:1687-1689`), as the VBL handler draws it over each frame.
  const draw = (): void => {
    if (isSaveMenuOpen(ui)) {
      // The dialog alone, drawn into the cleared screen: `_ReadEntireGame` reaches the
      // chooser through `SelectSaveGame(_9_, 1, 1, 1)` (`doc/CSBwin-src/SaveGame.cpp:1688`),
      // whose leading 1 is `_DoMenu`'s `FadeOldScreen` / `ClearOldScreen` pair
      // (`doc/CSBwin-src/Menu.cpp:285-291`), which `drawSaveMenu` does for either menu.
      ui.dialog?.draw(ui);
      shown = host.screen.pixels.slice();
      host.present();
      return;
    }
    if (shown) host.screen.pixels.set(shown);
    host.present();
    chooserClosed();
  };
  composer.setBootFrameRenderer(draw);
  // Forget a load made in play before the game was lost: only this chooser's read counts.
  deps.consumeSavedGameRead();
  openSaveMenu(ui, mode);
  draw();
  await fadeToPalette(host, palette11978(host));

  while (isSaveMenuOpen(ui)) {
    const event = await Promise.race([host.nextEvent(), closed]);
    if (!event) break;
    if (event.kind === 'click') ui.dialog?.click(ui, event.x, event.y, event.buttons);
    else if (event.key) ui.dialog?.key(ui, event.key, event.code ?? '');
    draw();
  }

  composer.setBootFrameRenderer(null);
  host.setCursorVisible(false);         // `STHideCursor(HC33)` (`SaveGame.cpp:1689`)
  return deps.consumeSavedGameRead();
}

/**
 * The chooser, then `tag01efee` if the read failed. `partyHasDied` is `d.PartyHasDied`:
 * false at the boot, true once the credits' RESTART THIS GAME has set it
 * (`doc/CSBwin-src/Mouse.cpp:1937`). Resolves to whether a save is in.
 */
async function readSavedGame(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead'>,
  partyHasDied: boolean,
): Promise<boolean> {
  const read = await openLoadMenu(host, deps);
  if (read === 'damaged') await tag01efee(host, menuScreen(deps.gameScreen.ui), partyHasDied);
  return read === 'loaded';
}

/**
 * RISE: the chooser over every data set's saves, whose LOAD makes a new adventure from
 * the one chosen and reads it (`SaveMenu`'s `rise` mode). A refusal is the utility's
 * message in a one-button menu (`utilityRefusal`), and a read that fails ends at
 * `tag01efee`, as RESUME's does. Resolves to whether the adventure is in.
 */
async function readNewAdventure(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead'>,
  partyHasDied: boolean,
): Promise<boolean> {
  const read = await openLoadMenu(host, deps, 'rise');
  if (read === 'damaged') await tag01efee(host, menuScreen(deps.gameScreen.ui), partyHasDied);
  else if (typeof read === 'object') await utilityRefusal(host, menuScreen(deps.gameScreen.ui), read.refused);
  return read === 'loaded';
}

/**
 * A `UtilityDiskMessages` text as the two titles of the boot's menu: its first line,
 * and the rest on one, which the menu splits once it is 30 characters or more
 * (`splitLongLine`). CSBWin's utility prints it in a dialog box of its own
 * (`_UtilityDialogBox`, `doc/CSBwin-src/Chaos.cpp:1423`), which the port does not have.
 */
export function utilityMenuTitles(message: string): [string, string | null] {
  const lines = message.split('\n').filter((line) => line.length > 0);
  return [lines[0] ?? '', lines.length > 1 ? lines.slice(1).join(' ') : null];
}

/**
 * The utility's refusal of a new adventure, and its OK: the button CSBWin's dialog
 * gives it (`UtilityDiskMessages[32]`, `doc/CSBwin-src/Chaos.cpp:1794`). The click goes
 * back to the entrance.
 */
async function utilityRefusal(host: IntroHost, menus: MenuScreen, message: string): Promise<void> {
  const [title1, title2] = utilityMenuTitles(message);
  await doMenuCentred(host, menus, title1, title2, ['OK']);
  host.setCursorVisible(true);
  await waitForMenuSelect(host, menus, 1);
  host.setCursorVisible(false);
}

/**
 * `_ReadEntireGame` once the entrance's doors have opened on a new game: `dungeon.dat`.
 * Where CSBWin's read fails it ends at `tag01efee` as a save's does; the port's ends the
 * game (`Game.readDungeonDat`), so the game is in when this returns.
 */
async function readNewGame(deps: Pick<BootSequenceDeps, 'readNewGame'>): Promise<boolean> {
  await deps.readNewGame();
  return true;
}

/**
 * `_GameSetup`'s `ReadEntireGame` for the entrance's choice: `dungeon.dat`, a save, or
 * RISE's new adventure.
 */
function readEntireGame(
  host: IntroHost,
  deps: Pick<BootSequenceDeps, 'gameScreen' | 'consumeSavedGameRead' | 'readNewGame'>,
  partyHasDied: boolean,
): (choice: PrisonDoorChoice) => Promise<boolean> {
  return (choice) => (choice === 'enter' ? readNewGame(deps)
    : choice === 'rise' ? readNewAdventure(host, deps, partyHasDied)
    : readSavedGame(host, deps, partyHasDied));
}

/**
 * What `die(0xbad)` stands for here: the boot's damaged file, acknowledged. `runBootSequence`
 * catches it and starts again from the title. CSBWin's `die` ends in `UI_Die`
 * (`doc/CSBwin-src/CSBCode.cpp:96-122`), which throws too (`CSBUI.cpp:1414-1417`), out to
 * the program's end.
 */
export class BadSavedGame extends Error {
  constructor() {
    super('SAVED GAME DAMAGED!');
  }
}

/**
 * `tag01efee`, where every failed read of `_ReadEntireGame` ends
 * (`doc/CSBwin-src/SaveGame.cpp:2098-2119`): a fade to `d.Palette11978`, then, after a
 * lost game, a one-button menu whose click goes back to `tag01ec56`, which returns -1 and
 * so puts the entrance up again (`:1681-1684`).
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
  host.setCursorVisible(true);          // `STShowCursor(HC33)` (`:2112`)
  await waitForMenuSelect(host, menus, 1);
  host.setCursorVisible(false);         // `STHideCursor(HC33)` (`:2114`)
  if (!partyHasDied) throw new BadSavedGame();
}

/**
 * `d.Palette11978`, the interface's palette: `_GameSetup` fills it from `d.Palette552[0]`
 * (`doc/CSBwin-src/CSBCode.cpp:10747`).
 */
function palette11978(host: IntroHost): readonly number[] {
  return host.uiTables.graphic232.palette552[0] ?? host.globalPalette;
}

/* ------------------------------------------------------------- the hand-off ---- */

/**
 * What the boot's menus draw through: `ui/Menu.ts`'s share, over the interface's screen
 * (`menuScreen`). A tool gives its own, which logs what `_DoMenu` was given.
 */
export interface MenuScreen {
  /** `_DoMenu`'s drawing into the screen. */
  doMenu(title1: string | null, title2: string | null, options: string[], centred: boolean): void;
  /** `d.pButn18970[set][count-1]`, the button list `_WaitForMenuSelect` puts up. */
  menuButtonList(count: number, centred: boolean): UIButton[];
  /** One pass of `_WaitForMenuSelect`'s press animation, the one `nowMs` falls in. */
  drawMenuPress(press: MenuPress, nowMs: number): void;
}

/** The boot's menus over the interface `ui`, drawing into its screen. */
function menuScreen(ui: UIState): MenuScreen {
  return {
    doMenu: (title1, title2, options, centred) => doMenu(ui, title1, title2, options, centred),
    menuButtonList: (count, centred) => menuButtonList(ui, count, centred),
    drawMenuPress: (press, nowMs) => drawMenuPress(ui, press, nowMs),
  };
}

/**
 * `_TAG021028`'s screen when the game was loaded (`doc/CSBwin-src/CSBCode.cpp:10617-10661`):
 * both `_ShowPrisonDoor` (`:10801`) and the restart (`Code1f9e6.cpp:318`) call it once
 * `_GameSetup` has returned. The rest of `_TAG021028`, the adventure's state and its first
 * frame, is the page's.
 *
 * CSBWin loops there on a menu, "GAME LOADED, READY TO PLAY." over PLAY GAME and ASCII
 * DUMP (`:10621-10639`). The port puts none up: a loaded game is played at once
 * (`doc/CSBWIN_MENU_REFERENCE.md` → "Deliberate divergences in this port"). It keeps what
 * that menu's `_DoMenu` did to the chooser's picture, `FadeOldScreen` and `ClearOldScreen`
 * (`Menu.cpp:285-292`), a fade to black and a cleared screen, and then `wvbl(_4_)` and the
 * cleared screen the adventure opens on (`CSBCode.cpp:10659-10660`).
 */
export async function tag021028(host: IntroHost, choice: PrisonDoorChoice): Promise<void> {
  if (choice === 'enter') return;
  await fadeToPalette(host, PALETTE_11914);
  host.screen.pixels.fill(0);
  await host.vbl(4);
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
  menus: MenuScreen,
  title1: string | null,
  title2: string | null,
  options: string[],
): Promise<void> {
  await fadeToPalette(host, PALETTE_11914);   // `:285-288`
  host.screen.pixels.fill(0);                 // `:289-292`
  menus.doMenu(title1, title2, options, true);
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
async function waitForMenuSelect(host: IntroHost, menus: MenuScreen, numButton: number): Promise<number> {
  const buttons = menus.menuButtonList(numButton, true);
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
    menus.drawMenuPress(press, 0);
    host.present();
    await host.vbl(5);
    menus.drawMenuPress(press, MENU_PRESS_PHASE_MS);
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
 * (`doc/CSBwin-src/CSBCode.cpp:10259-10276`); `extractUITables` returns an empty list
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
    // The disk's boot, not the game program's: once, and not again after `BadSavedGame`.
    if (deps.swoosh) await showSwoosh(host, deps.swoosh.image, deps.swoosh.startSound);
    for (;;) {
      try {
        if (deps.title) {
          if (deps.titlePicture) await showTitlePicture(host, deps.titlePicture);
          else await displayChaosStrikesBack(host);
        }
        const choice = await showPrisonDoor(host, prisonDoorButtons(host), async (c) => {
          if (!(await readGame(c))) return false;
          read = c;
          return true;
        }, deps.rise, deps.amiga);
        await tag021028(host, choice);
        return choice;
      } catch (error) {
        if (!(error instanceof BadSavedGame)) throw error;
      }
    }
  } catch (error) {
    if (error instanceof Die) throw error;
    console.error('Boot sequence failed; entering the dungeon anyway', error);
    return read ?? enterAnyway(deps);
  } finally {
    detach();
  }
}

/** A new game read with no entrance to go back to: a failed read throws. */
async function enterAnyway(deps: Pick<BootSequenceDeps, 'readNewGame'>): Promise<PrisonDoorChoice> {
  await deps.readNewGame();
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
 * `d.Palette552[0]` (`CSBCode.cpp:10747`).
 */
export async function runShowCredits(deps: Omit<BootSequenceDeps, 'skip' | 'title'>, hooks: ShowCreditsHooks): Promise<EndOfGame> {
  const uiTables = deps.gameScreen.ui.uiTables;
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
 * `GameSetup(_25_, 0)` (`doc/CSBwin-src/Code1f9e6.cpp:310`, `CSBCode.cpp:10713`): no
 * entrance first. `d.Initialize()` has just left `d.gameState` at 0,
 * `GAMESTATE_ResumeSavedGame`, so its `ReadEntireGame` is the save chooser; a cancel puts
 * the entrance up, and the loop goes on from there as it does at boot (`:10758-10765`),
 * with `d.PartyHasDied` set, so a failed read of `dungeon.dat` or a save goes back to the
 * entrance too.
 */
async function gameSetupAfterRestart(host: IntroHost, deps: Omit<BootSequenceDeps, 'skip' | 'title'>): Promise<PrisonDoorChoice> {
  const readGame = readEntireGame(host, deps, true);
  const choice = (await readGame('resume')) ? 'resume' : await showPrisonDoor(host, prisonDoorButtons(host), readGame, deps.rise, deps.amiga);
  await tag021028(host, choice);
  return choice;
}

/* ------------------------------------------------------------ the Oracle ---- */

/**
 * What the message area says when the Oracle fails, and its colour, the save messages'.
 * The port's words: CSBWin's error routine, `TAG0093a0_17`, draws nothing
 * (`doc/CSBwin-src/Hint.cpp:7903-7908`).
 */
export const HINT_ORACLE_FAILED = 'UNABLE TO READ THE HINTS!';
const HINT_ORACLE_FAILED_COLOR = 15;

/**
 * `runHintOracle`, as its button opens it: an Oracle that fails closes with a line in
 * the message area, and the game goes on. `hcsb.hct` read under a key that does not
 * decipher it fails so, as an imported save of a modified CSB gives. Resolves to the
 * error, for the page's console, or `null`; it never rejects.
 */
export async function openHintOracle(
  deps: HostDeps, files: HintOracleFiles, square: HintSquare, hintKey: Uint8Array | undefined, messages: MessageSink,
): Promise<unknown> {
  try {
    await runHintOracle(deps, files, square, hintKey);
    return null;
  } catch (error) {
    messages.printLinefeed();
    messages.quePrintLines(HINT_ORACLE_FAILED_COLOR, HINT_ORACLE_FAILED);
    return error;
  }
}

/**
 * The Hint Oracle on `square`, opened by its button in the inventory
 * (`src/renderer/ui/HintOracleButton.ts`), until DONE on its title list closes it. The
 * screen has been composed with `TAG02076e`'s shading, and its game stands still; this
 * host takes the canvas until the Oracle closes, and the page then shows the inventory
 * again.
 *
 * The colour registers are the interface's, as the open inventory shows the screen
 * through them (`ScreenComposer.presentViewport`), so the Oracle's first fade starts from the
 * screen as it was. CSBWin's Oracle shows the system's pointer throughout
 * (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "Leaving"); the page's canvas hides it, so the
 * arrow stands in for it.
 *
 * `hcsb.hct` is read under `hintKey`, the running world's, as CSBWin's Oracle reads it
 * under the saved game's (`readHintOracle`). A file that does not read throws before the
 * screen is taken.
 */
export async function runHintOracle(
  deps: HostDeps, files: HintOracleFiles, square: HintSquare, hintKey: Uint8Array | undefined,
): Promise<void> {
  const hints = readHintOracle(files.hct, hintKey);
  const uiTables = deps.gameScreen.ui.uiTables;
  // The Oracle takes no key (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "Waiting for a
  // button"), and the browser does nothing with one but a shortcut.
  const { host, detach } = createIntroHost(deps, uiTables.graphic232.palette552[0] ?? PALETTE_11914, true);
  try {
    const oracle = new HintOracleScreen(host, hints, files.dat, square);
    introProbe.oracle = oracle;
    host.setCursorVisible(true);
    await oracle.run();
  } finally {
    introProbe.oracle = null;
    host.setCursorVisible(false);
    detach();
  }
}
