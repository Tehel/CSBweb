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
 * 4. the fade back to the dark blue, the credits picture, graphic 5, in `d.Palette328`,
 *    until a button is held or a key waits (`:326-337`);
 * 5. `UI_PushMessage(UIM_TERMINATE)` (`:349`), and the program ends.
 *
 * Only the lost game's path is ported. The rest of the function is `DEBT.md` G13: with
 * `d.CanRestartFromSavegame` the end picture carries "RESTART THIS GAME" and the credits go
 * back to it (step 2), and the won game shows the champions instead (step 3).
 */
import { tag0088b2Index } from '../csbwin/CanvasBlitter';
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

/** `fillMemory((i16 *)&LOCAL_110, 16, 2, 2)` (`:230`): sixteen words of `0x002`. */
export const PALETTE_LOCAL_110: readonly number[] = new Array(16).fill(0x002);

/** `LOCAL_46`: `LOCAL_110` with `color[15] = 0x777` (`:231-233`), white on dark blue. */
export const PALETTE_LOCAL_46: readonly number[] = PALETTE_LOCAL_110.map((c, i) => (i === 15 ? 0x777 : c));

export interface ShowCreditsHooks {
  /** `QueueSound(6, d.partyX, d.partyY, 0)`: the engine's, at the party's square. */
  queueDyingSound(): void;
}

/**
 * `_ShowCredits(1)` of a lost game with `d.CanRestartFromSavegame` clear. It returns when
 * CSBWin would push `UIM_TERMINATE`, with the credits picture on the screen.
 */
export async function showCredits(host: IntroHost, hooks: ShowCreditsHooks): Promise<void> {
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

  // `tag01fd10` (`:227-238`).
  host.screen.pixels.fill(0);
  tag0088b2Index(theEnd, host.screen, { ...rects.word108, srcX: 0, srcY: 0, srcStride: theEnd.width }, -1);
  await fadeToPalette(host, PALETTE_LOCAL_46);
  await host.vbl(THE_END_VBLS);
  // `if (d.CanRestartFromSavegame)` (`:240-325`) is G13 step 2.
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
}
