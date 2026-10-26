/**
 * The end of the game — `_ShowCredits`, `doc/CSBwin-src/Code1f9e6.cpp:66`.
 *
 * `MainLoop` returns on the tick the last champion dies, and `_StartCSB` clears
 * `d.DynamicPaletteSwitching` and calls `ShowCredits(_3_, d.GameIsLost)`
 * (`doc/CSBwin-src/CSBCode.cpp:11557-11561`). What follows is a still picture and a wait,
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
 * A won game, `d.Word11694` set, has no dying sound, and after the fade shows the
 * champions instead, for good (`:171-225`, `showChampions`). The CSB win's actuator type
 * 18 sets it (`Game.gameTick`), and so does `_FusionSequence` (`Fusion.ts`'s `fusionSequence`).
 */
import { fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import type { IndexedBitmap } from '../csbwin/CanvasBlitter';
import type { UIButton } from '../../data/tables/UITables';
import { MASTERY_LABELS, ROLE_LABELS } from '../ui/Character';
import { searchButtonList } from '../ui/HitTest';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import { PALETTE_11914, fadeToPalette, type IntroHost } from './IntroHost';

/** `ReadAndExpandGraphic(6, …)` (`:137`): "THE END", 80x14 — the 560 bytes `A3` skips. */
const GRAPHIC_THE_END = 6;
/** `ReadAndExpandGraphic(0x8005, …)` (`:145`), the picture the entrance's scroll shows too. */
const GRAPHIC_CREDITS = 5;
/**
 * `ReadAndExpandGraphic(208, …)` (`:141`): the frame round a champion on the won screen,
 * 64x43 — the 1376 bytes `A3` skips.
 */
export const GRAPHIC_CHAMPION_FRAME = 208;
/** `D6L = 48 * D7W`, and `d.Word132` and `d.Word140` moved down 48 a champion (`:177`, `:211-214`). */
export const WON_CHAMPION_PITCH = 48;
/** `QueueSound(6, d.partyX, d.partyY, 0); //Dying sound` (`:126`). */
export const SOUND_DYING = 6;
/** `VBLDelay(_1_, 240); // About 4 seconds` (`:127`). */
export const DYING_SOUND_VBLS = 240;
/** `VBLDelay(_7_, 300); // About 5 seconds` (`:238`). */
export const THE_END_VBLS = 300;
/** `for (D7W=900; (--D7W!=0)&&(d.PartyHasDied==0);)` (`:260`): 899 VBLs at most. */
export const RESTART_BUTTON_VBLS = 899;
/** The button `HandleMouseEvents` answers with `d.PartyHasDied = 1` (`Mouse.cpp:1937`). */
const BUTTON_RESTART_THIS_GAME = 0xd7;

/** `fillMemory((i16 *)&LOCAL_110, 16, 2, 2)` (`:230`): sixteen words of `0x002`. */
const PALETTE_LOCAL_110: readonly number[] = new Array(16).fill(0x002);

/** `LOCAL_46`: `LOCAL_110` with `color[15] = 0x777` (`:231-233`), white on dark blue. */
export const PALETTE_LOCAL_46: readonly number[] = PALETTE_LOCAL_110.map((c, i) => (i === 15 ? 0x777 : c));

/** `LOCAL_46` once the button is drawn: its border `0x437`, its text white (`:248-249`). */
export const PALETTE_RESTART: readonly number[] = PALETTE_LOCAL_46.map((c, i) => (i === 1 ? 0x437 : i === 4 ? 0x777 : c));

/**
 * `LOCAL_78` (`:76`), a static: the `Darken` branch saves `d.Palette11978` in it (`:150`),
 * and nothing else writes it, so without `d.DynamicPaletteSwitching` the won screen fades
 * up to sixteen zeros, black.
 */
const LOCAL_78: number[] = new Array(16).fill(0);

/** What the won screen shows of a champion, `d.CH16482[D7W]` (`:178-210`). */
export interface WonChampion {
  name: string;
  title: string;
  /** `*(name + 9)` (`:187`): the title's second byte, as `CHARDESC.name` is 8 bytes. */
  titleByte1: number;
  /** `CHARDESC.portrait`, 32x29. */
  portrait: IndexedBitmap | null;
  /** `DetermineMastery(D7W, D5W | 0xc000)` for the four base skills (`:195`). */
  masteries: readonly number[];
}

export interface ShowCreditsHooks {
  /** `QueueSound(6, d.partyX, d.partyY, 0)`: the engine's, at the party's square. */
  queueDyingSound(): void;
  /** `d.CanRestartFromSavegame`: the game was saved or loaded since it began. */
  canRestartFromSavegame: boolean;
  /** `d.Word11694`: the game is won. */
  word11694: boolean;
  /** `d.CH16482[0 … d.NumCharacter - 1]`, for the won screen. */
  champions: readonly WonChampion[];
  /**
   * `d.Palette11946` if `d.DynamicPaletteSwitching` is on, `null` if it is off. `_StartCSB`
   * turns it off before a lost game's `ShowCredits` (`doc/CSBwin-src/CSBCode.cpp:11558`).
   */
  palette11946: readonly number[] | null;
}

/**
 * How `_ShowCredits` ends: `'restart'` with the screen black in `d.Palette552[0]` and the
 * game to be set up again, `'terminate'` where CSBWin pushes `UIM_TERMINATE`, with the
 * credits picture up.
 */
type ShowCreditsEnd = 'restart' | 'terminate';

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
  if (!hooks.word11694) {
    hooks.queueDyingSound();
    await host.vbl(DYING_SOUND_VBLS);
  }

  const theEnd = host.getGraphic(GRAPHIC_THE_END);
  const credits = host.getGraphic(GRAPHIC_CREDITS);
  host.palette11946 = hooks.palette11946 ? [...hooks.palette11946] : null;
  host.present();
  if (host.palette11946) {
    // `:148-166`: `d.Palette11978` saved in `LOCAL_78`, then both palettes darkened a step
    // a VBL, eight times: black. The display copies `d.Palette11978` into `globalPalette`
    // while switching is on, so the port darkens `globalPalette`; the copy back into
    // `d.Palette11978` (`:165`) never reaches it, as switching is off before the next.
    LOCAL_78.splice(0, 16, ...host.globalPalette);
    for (let step = 0; step <= 7; step++) {
      await host.vbl(1);
      for (let i = 0; i < 16; i++) {
        host.palette11946[i] = darken(host.palette11946[i] ?? 0);
        host.globalPalette[i] = darken(host.globalPalette[i] ?? 0);
      }
      host.present();
    }
    await host.vbl(1);
  } else {
    // The whole screen is in `globalPalette`, the interface's, and fades from it (`:168-170`).
    await fadeToPalette(host, PALETTE_11914);
  }
  if (hooks.word11694) {
    await showChampions(host, hooks.champions);
    return 'terminate';
  }

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

/** `Darken` (`doc/CSBwin-src/Code1f9e6.cpp:27`): each channel one step nearer 0. */
export function darken(color: number): number {
  if (color & 0x007) color -= 0x001;
  if (color & 0x070) color -= 0x010;
  if (color & 0x700) color -= 0x100;
  return color;
}

/**
 * `DisplayHeroName` (`doc/CSBwin-src/Code1f9e6.cpp:39`): `A`-`Z` moved down 0x40, to the
 * font's glyphs 1-26, and printed on colour 12.
 */
function displayHeroName(host: IntroHost, x: number, y: number, color: number, text: string): void {
  let codes = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    codes += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code - 0x40) : ch;
  }
  drawTextLineIndexRaw(host.screen, host.font, x, y, color, 12, codes);
}

/**
 * The won screen (`:171-225`): each champion's frame, portrait, name, title and masteries
 * on colour 12, faded up to `LOCAL_78` with switching off. `RepeatGame` is false, so its
 * wait never ends (`:219-222`), and neither does the game: the screen stays.
 */
async function showChampions(host: IntroHost, champions: readonly WonChampion[]): Promise<void> {
  const rects = host.uiTables.graphic232;
  const frame = host.getGraphic(GRAPHIC_CHAMPION_FRAME);
  // `Flood(d.LogicalScreenBase, 12, 0xfa0)`: 4000 words, the whole screen.
  host.screen.pixels.fill(12);
  champions.forEach((champion, d7) => {
    const down = WON_CHAMPION_PITCH * d7;
    const r132 = rects.word132;
    const r140 = rects.word140;
    tag0088b2Index(frame, host.screen, { x1: r132.x1, x2: r132.x2, y1: r132.y1 + down, y2: r132.y2 + down, srcX: 0, srcY: 0, srcStride: frame.width }, 10);
    if (champion.portrait) {
      const portrait = champion.portrait;
      tag0088b2Index(portrait, host.screen, { x1: r140.x1, x2: r140.x2, y1: r140.y1 + down, y2: r140.y2 + down, srcX: 0, srcY: 0, srcStride: portrait.width }, 1);
    }
    let d6 = down + 14;
    displayHeroName(host, 87, d6, 9, champion.name);
    let d5 = 6 * champion.name.length + 87;
    const byte9 = champion.titleByte1;
    if (byte9 !== 44 && byte9 !== 59 && byte9 !== 45) d5 += 5;
    displayHeroName(host, d5, d6++, 9, champion.title);
    for (let skill = 0; skill <= 3; skill++) {
      const d4 = Math.min(16, champion.masteries[skill] ?? 0);
      if (d4 === 1) continue;
      if (d4 === 0) throw new Error('Mastery = 0'); // `die(0x8d49, …)`
      displayHeroName(host, 105, (d6 += 8), 13, `${MASTERY_LABELS[d4]} ${ROLE_LABELS[skill]}`);
    }
  });
  // `d.DynamicPaletteSwitching = 0; videoMode = VM_CAST;`
  host.palette11946 = null;
  await fadeToPalette(host, LOCAL_78);
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
    { ...buttons16956[0]!, word0: BUTTON_RESTART_THIS_GAME, x1: 0x67, x2: 0xd9, y1: 0x91, y2: 0x9f },
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
