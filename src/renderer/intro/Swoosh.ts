/**
 * The FTL logo, before the title: an extra, since CSBWin never had it.
 *
 * The Atari ST disk boots into `SWOOSH.IMG`, which draws the logo while the palette is
 * black, starts its sound, and shows the picture's sixteen colours in turn from a script
 * of palette changes and waits (`swoosh.img:$0002`–`$0044`). The picture and the script
 * are the file's own, read by `loadSwoosh` (`src/data/SwooshLoader.ts`); this is the
 * script's interpreter. `doc/ATARI_ST_DISK_REFERENCE.md` → "`SWOOSH.IMG`" has all of it.
 */
import type { Swoosh } from '../../data/SwooshLoader';
import { fadeToPalette, PALETTE_11914, type IntroHost } from './IntroHost';

/**
 * How long the finished logo stays up, in VBLs. **The author's arbitrary choice**: on the
 * disk the logo stays until the game program has loaded, which the disk does not time,
 * and the one recording of it gives no figure to copy.
 */
export const SWOOSH_HOLD_VBLS = 60;

/** `cmpi.w #8,d7 / bcs` (`swoosh.img:$0018`): a word below this is a wait. */
const SCRIPT_FIRST_COLOUR = 8;

/**
 * Show the logo, hold it, and fade to black for the title. `startSound` is
 * `Dosound($0b5a)`, the call the script's interpreter opens with (`swoosh.img:$0002`).
 */
export async function showSwoosh(
  host: Pick<IntroHost, 'screen' | 'globalPalette' | 'present' | 'vbl'>,
  swoosh: Swoosh,
  startSound: () => void,
): Promise<void> {
  // The boot sector clears all sixteen registers (`boot:$0060`), and the picture is
  // decoded straight into screen memory under them (`swoosh.img:$0070`).
  host.globalPalette.fill(0);
  host.screen.pixels.set(swoosh.pixels);
  host.present();

  startSound();
  for (const word of swoosh.script) {
    if (word < SCRIPT_FIRST_COLOUR) {
      // `Vsync` in a `dbra` on the word (`swoosh.img:$0038`): word + 1 of them.
      host.present();
      await host.vbl(word + 1);
    } else {
      // `Setcolor(w >> 12, w & $777)` (`swoosh.img:$001c`).
      host.globalPalette[word >> 12] = word & 0x777;
    }
  }
  host.present();

  await host.vbl(SWOOSH_HOLD_VBLS);
  await fadeToPalette(host, PALETTE_11914);
  host.screen.pixels.fill(0);
}
