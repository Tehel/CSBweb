/**
 * The end of the game — `_ShowCredits`, `doc/CSBwin-src/Code1f9e6.cpp:66`.
 *
 * `MainLoop` returns on the tick the last champion dies, and `_StartCSB` clears
 * `d.DynamicPaletteSwitching` and calls `ShowCredits(_3_, d.GameIsLost)`
 * (`doc/CSBwin-src/CSBCode.cpp:11322-11326`). What follows is a still picture and a wait,
 * drawn straight to the screen like the pre-game screens, so it runs over the same
 * `IntroHost`:
 *
 * 1. the dying sound, and 240 VBLs (`:122-129`);
 * 2. the fade to black: `d.DynamicPaletteSwitching` is 0, so `FadeToPalette(Palette11914)`
 *    rather than the `Darken` steps (`:148-170`);
 * 3. "THE END", graphic 6, alone on a cleared screen at `d.Word108`, faded up to a palette
 *    of `0x002` with colour 15 at `0x777`, and 300 VBLs (`:227-238`);
 * 4. with `d.CanRestartFromSavegame` set, the "RESTART THIS GAME" button for 899 VBLs
 *    (`:240-282`); pressed, the screen goes black and the game is set up again
 *    (`:283-322`), which is the caller's;
 * 5. the fade back to the dark blue, the credits picture, graphic 5, in `d.Palette328`,
 *    until a button is held or a key waits (`:326-337`);
 * 6. with `d.CanRestartFromSavegame` set, back to "THE END" without the 300 VBLs
 *    (`:339-348`); otherwise `UI_PushMessage(UIM_TERMINATE)` (`:349`), and the program ends.
 *
 * Only the lost game is ported. The won game shows the champions instead (`DEBT.md` G13
 * step 3).
 */
import { fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex } from '../csbwin/TextRenderer';
import type { UIButton } from '../csbwin/UITables';
import { searchButtonList } from '../ui/HitTest';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import { PALETTE_11914, fadeToPalette, type IntroHost } from './IntroHost';

/** `ReadAndExpandGraphic(6, …)` (`:137`): "THE END", 80x14 — the 560 bytes `A3` skips. */
const GRAPHIC_THE_END = 6;
/** `ReadAndExpandGraphic(0x8005, …)` (`:145`), the picture the entrance's scroll shows too. */
const GRAPHIC_CREDITS = 5;
/** `QueueSound(6, d.partyX, d.partyY, 0); //Dying sound` (`:126`). */
export const SOUND_DYING = 6;
/** `VBLDelay(_1_, 240); // About 4 seconds` (`:127`). */
export const DYING_SOUND_VBLS = 240;
/** `VBLDelay(_7_, 300); // About 5 seconds` (`:238`). */
export const THE_END_VBLS = 300;
/** `for (D7W=900; (--D7W!=0)&&(d.PartyHasDied==0);)` (`:260`): 899 VBLs at most. */
export const RESTART_BUTTON_VBLS = 899;
/** The button `HandleMouseEvents` answers with `d.PartyHasDied = 1` (`Mouse.cpp:1798`). */
export const BUTTON_RESTART_THIS_GAME = 0xd7;

/** `fillMemory((i16 *)&LOCAL_110, 16, 2, 2)` (`:230`): sixteen words of `0x002`. */
export const PALETTE_LOCAL_110: readonly number[] = new Array(16).fill(0x002);

/** `LOCAL_46`: `LOCAL_110` with `color[15] = 0x777` (`:231-233`), white on dark blue. */
export const PALETTE_LOCAL_46: readonly number[] = PALETTE_LOCAL_110.map((c, i) => (i === 15 ? 0x777 : c));

/** `LOCAL_46` once the button is drawn: its border `0x437`, its text white (`:248-249`). */
export const PALETTE_RESTART: readonly number[] = PALETTE_LOCAL_46.map((c, i) => (i === 1 ? 0x437 : i === 4 ? 0x777 : c));

export interface ShowCreditsHooks {
  /** `QueueSound(6, d.partyX, d.partyY, 0)`: the engine's, at the party's square. */
  queueDyingSound(): void;
  /** `d.CanRestartFromSavegame`: the game was saved or loaded since it began. */
  canRestartFromSavegame: boolean;
}

/**
 * How `_ShowCredits` ends: `'restart'` with the screen black in `d.Palette552[0]` and the
 * game to be set up again, `'terminate'` where CSBWin pushes `UIM_TERMINATE`, with the
 * credits picture up.
 */
export type ShowCreditsEnd = 'restart' | 'terminate';

/**
 * `_ShowCredits(1)` of a lost game. `'restart'` is the "RESTART THIS GAME" button's
 * `GameSetup(_25_, 0)` (`:283-322`), which the caller runs once `Cleanup(false)` and
 * `d.Initialize()` have cleared the whole of `d`.
 */
export async function showCredits(host: IntroHost, hooks: ShowCreditsHooks): Promise<ShowCreditsEnd> {
  const rects = host.uiTables.graphic232;
  // `SetCursorShape(0); STHideCursor(HC50);` and the four input tables emptied (`:116-121`):
  // the caller has stopped the adventure's input.
  host.setCursorVisible(false);
  hooks.queueDyingSound();
  await host.vbl(DYING_SOUND_VBLS);

  const theEnd = host.getGraphic(GRAPHIC_THE_END);
  const credits = host.getGraphic(GRAPHIC_CREDITS);
  // `d.DynamicPaletteSwitching` is 0: the whole screen is in `globalPalette`, the
  // interface's, and fades from it (`:168-170`).
  host.present();
  await fadeToPalette(host, PALETTE_11914);

  // `LOCAL_132`: only the first "THE END" waits its 300 VBLs.
  let firstTime = true;
  for (;;) {
    // `tag01fd10` (`:227-238`).
    host.screen.pixels.fill(0);
    tag0088b2Index(theEnd, host.screen, { ...rects.word108, srcX: 0, srcY: 0, srcStride: theEnd.width }, -1);
    await fadeToPalette(host, PALETTE_LOCAL_46);
    if (firstTime) await host.vbl(THE_END_VBLS);
    if (hooks.canRestartFromSavegame && (await offerRestart(host))) {
      // `:285-288`: to black, then the interface's palette over the black screen.
      await fadeToPalette(host, PALETTE_LOCAL_110);
      host.screen.pixels.fill(0);
      await fadeToPalette(host, rects.palette552[0] ?? PALETTE_11914);
      return 'restart';
    }
    await fadeToPalette(host, PALETTE_LOCAL_110);

    // `ExpandGraphic(LOCAL_10, d.LogicalScreenBase, 0, 0)` (`:328`): the whole screen.
    tag0088b2Index(credits, host.screen, { x1: 0, x2: SCREEN_WIDTH - 1, y1: 0, y2: SCREEN_HEIGHT - 1, srcX: 0, srcY: 0, srcStride: credits.width }, -1);
    await fadeToPalette(host, rects.palette328);
    // `do { …; if (d.MouseSwitches != 0) break; wvbl(_19_); D0W = UI_CONSTAT(); }
    // while (D0W == 0)` (`:330-337`, with `RepeatGame` false).
    do {
      if (host.mouseSwitches() !== 0) break;
      await host.vbl(1);
    } while (!host.keyWaiting());
    if (!hooks.canRestartFromSavegame) return 'terminate';

    // `:339-347`. Its `STShowCursor(HC33); STHideCursor(HC50);` leaves the cursor hidden.
    firstTime = false;
    await fadeToPalette(host, PALETTE_LOCAL_110);
  }
}

/**
 * `if (d.CanRestartFromSavegame)` (`:240-282`): the button under "THE END", and 899 VBLs
 * for a click on it. Returns whether it was clicked, `d.PartyHasDied`.
 */
async function offerRestart(host: IntroHost): Promise<boolean> {
  const rects = host.uiTables.graphic232;
  // `d.UseByteCoordinates = 0`: the word rectangles. Colours 1 and 4 are still `0x002`, so
  // nothing shows until the fade (`:242-249`).
  fillRectIndex(host.screen, rects.word116, 1);
  host.present();
  await host.vbl(1);
  fillRectIndex(host.screen, rects.word124, 0);
  drawTextLineIndex(host.screen, host.font, 110, 0x9a, 4, 0, 'RESTART THIS GAME');

  // `d.PrimaryButtonList = d.Buttons16956`, its first entry rewritten (`:250-255`): the
  // entry keeps its mouse-button mask, and the second stays the terminator.
  const buttons16956 = host.uiTables.graphic231.buttons.buttons16956;
  const list: UIButton[] = [
    { ...buttons16956[0], word0: BUTTON_RESTART_THIS_GAME, x1: 0x67, x2: 0xd9, y1: 0x91, y2: 0x9f },
    ...buttons16956.slice(1),
  ];
  host.discardAllInput();
  host.setCursorVisible(true);
  await fadeToPalette(host, PALETTE_RESTART);

  // `:260-277`. CSBWin queues a click only once it has found its button, so a click
  // anywhere else never reaches `HandleMouseEvents`.
  let partyHasDied = false;
  for (let d7 = RESTART_BUTTON_VBLS + 1; --d7 !== 0 && !partyHasDied; ) {
    for (let click = host.takeClick(); click && !partyHasDied; click = host.takeClick()) {
      if (searchButtonList(list, click.x, click.y, click.buttons) === BUTTON_RESTART_THIS_GAME) partyHasDied = true;
    }
    await host.vbl(1);
  }
  // `STHideCursor(HC33); ForceScreenDraw();` (`:280-281`).
  host.setCursorVisible(false);
  host.present();
  return partyHasDied;
}
