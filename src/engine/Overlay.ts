/**
 * The viewport overlay: CSBWin's `currentOverlay` (`OVERLAYDATA`, `doc/CSBwin-src/CSB.h:220-237`,
 * `data.cpp:66`), `overlayActive` (`data.cpp:69`) and the four jitters (`data.cpp:70-73`),
 * process-wide globals and not `d.`'s, with what changes them: a DSA's `&OVERLAY`
 * (`SelectOverlay`), `&PALETTE` (`SetOverlayPalette`) and `&JITTER`, the clock
 * (`expire`), and a read's Extended Features block (`readExtendedFeatures`).
 *
 * `display` draws the viewport through them in `VM_ADVENTURE`
 * (`doc/CSBwin-src/WinScreen.cpp:1515-1527`, `Graphics.cpp:3005-3117`), the port's
 * `src/renderer/csbwin/OverlayScreen.ts`. Neither has it `m_change`, `jitterChanged` or
 * `ForceScreenDraw`: they tell `UpdateScreenArea` an area must be drawn again, and the
 * port composes the whole screen at every present.
 */
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import { CSBGraphicType } from '../data/CSBGraphicsLoader';
import { readU16LE, readU32LE } from '../core/bytes';
import { div } from '../core/intCast';
import type { ExtendedFeaturesBlock, SavedOverlay } from '../data/CsbwinExtendedFeatures';
import { EF_EXTENDED_FLAGS } from '../data/CsbwinExtendedFeatures';
import { identityOverlayPalette } from './OverlayPalette';

/** The overlay's width and height: `m_overlay` is `136*224` bytes (`Graphics.cpp:2977`). */
export const OVERLAY_WIDTH = 224;
export const OVERLAY_HEIGHT = 136;

/** `sizeof(CSB_BITMAPFILEHEADER)` and `sizeof(CSB_BITMAPINFOHEADER)` (`CSB.h:299-320`). */
const BITMAP_FILE_HEADER_SIZE = 14;
const BITMAP_INFO_HEADER_SIZE = 40;

/** `OVERLAYDATA`: the overlay in memory, `currentOverlay`. */
export class OverlayData {
  /** `m_overlayNumber`: the section read last, -1 for none (`Cleanup`). */
  overlayNumber = -1;
  /**
   * `m_overlay`: 136 lines of 224 colour bytes, as the file stores them, bottom line
   * first (`UpdateScreenArea` reads line `135 - line`, `WinScreen.cpp:1249`). `null` until
   * `Allocate`, and again after `Cleanup`. CSBWin's `UI_malloc` leaves it as memory had
   * it; here it starts zeroed. A read copies its bitmap over it and leaves the rest.
   */
  overlay: Uint8Array | null = null;
  /** `m_overlayPalette`: the bitmap's 256 colours, `0x00RRGGBB`, as `overlay` is kept. */
  overlayPalette: Uint32Array | null = null;
  /** `m_p1`: bit 0, colour `p4` is transparent; bit 1, the overlay is mirrored. */
  p1 = 0;
  /** `m_p2`: the graphic's share of a pixel, in percent (`CreateOverlayTable`'s `transparency`). */
  p2 = 0;
  /** `m_p3`: the `d.Time` the overlay ends after, 0 for never. */
  p3 = 0;
  /** `m_p4`: the transparent colour. */
  p4 = 0;

  /** `OVERLAYDATA::Allocate` (`doc/CSBwin-src/Graphics.cpp:2974-2982`), but `m_table`. */
  Allocate(): void {
    if (this.overlay === null) this.overlay = new Uint8Array(OVERLAY_WIDTH * OVERLAY_HEIGHT);
    if (this.overlayPalette === null) this.overlayPalette = new Uint32Array(256);
  }

  /** `OVERLAYDATA::Cleanup` (`Graphics.cpp:2985-3003`): the memory freed, the number -1. */
  Cleanup(): void {
    this.overlay = null;
    this.overlayPalette = null;
    this.overlayNumber = -1;
  }

  /**
   * `OVERLAYDATA::Mirror` (`doc/CSBwin-src/Bitmaps.cpp:632-649`): every line reversed.
   * CSBWin reverses through a null `m_overlay` after a `Cleanup`, which a failed read can
   * reach; here that does nothing.
   */
  Mirror(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    for (let line = 0; line < OVERLAY_HEIGHT; line++) {
      let f = line * OVERLAY_WIDTH;
      let l = f + OVERLAY_WIDTH - 1;
      for (let i = 0; i < OVERLAY_WIDTH / 2; i++, f++, l--) {
        const temp = overlay[f]!;
        overlay[f] = overlay[l]!;
        overlay[l] = temp;
      }
    }
  }
}

export class Overlay {
  /** `currentOverlay`. */
  readonly current = new OverlayData();
  /** `overlayActive`: the overlay is drawn over the viewport. */
  active = false;
  /** `xGraphicJitter`, `yGraphicJitter`, `xOverlayJitter`, `yOverlayJitter`, set by `&JITTER`. */
  xGraphicJitter = 0;
  yGraphicJitter = 0;
  xOverlayJitter = 0;
  yOverlayJitter = 0;
  /**
   * `CSBgraphics.dat`, where the overlays and the overlay palettes are. The page sets it
   * to its data set's; `null`, as a tool leaves it, is a data set without the file.
   */
  csbGraphics: Pick<CSBGraphicsLoader, 'readSection'> | null = null;
  /** `ReadOverlay`'s `firstTime`: a complaint is said once, or until one clears it. */
  private firstTime = true;

  /**
   * @param overlayPalette the overlay palette (`GameContext.overlayPalette`), which
   *   `SetOverlayPalette` blends in place.
   * @param trace where `ReadOverlay`'s complaints go, CSBWin's message boxes
   *   (`GameHost.trace`).
   */
  constructor(
    private readonly overlayPalette: Uint8Array,
    private readonly trace: (line: string) => void,
  ) {}

  /**
   * `OVERLAYDATA::ReadOverlay` (`doc/CSBwin-src/Bitmaps.cpp:572-630`): section `onum` of
   * `CGT_ViewportOverlay`, a Windows bitmap of one byte a pixel, into `m_overlay` and its
   * colours into `m_overlayPalette`, the parameters back to 0. False, and nothing read,
   * for a section missing, shorter than its bitmap says, or of more than 136*224 bytes.
   *
   * `bmpsize` is the width rounded up to even times the height, copied without regard to
   * the lines' width, and no more than `biClrUsed` colours (256 if 0) are copied. CSBWin
   * copies them all into its 256, past the end for more; here the copy stops at 256.
   */
  ReadOverlay(onum: number): boolean {
    const fileData = this.csbGraphics?.readSection(
      CSBGraphicType.ViewportOverlay, onum, BITMAP_FILE_HEADER_SIZE + BITMAP_INFO_HEADER_SIZE) ?? null;
    if (fileData === null) {
      if (!this.firstTime) return false;
      this.firstTime = false;
      this.trace('Cannot find overlay');
      return false;
    }
    const fileSize = fileData.length;
    const bmiHeader = BITMAP_FILE_HEADER_SIZE;
    const colors = bmiHeader + BITMAP_INFO_HEADER_SIZE;
    let numColor = 256;
    const biClrUsed = readU32LE(fileData, bmiHeader + 32);
    if (biClrUsed !== 0) numColor = biClrUsed;
    const pixels = colors + 4 * numColor;
    const biWidth = readU32LE(fileData, bmiHeader + 4) | 0;
    const biHeight = readU32LE(fileData, bmiHeader + 8) | 0;
    const bmpsize = Math.imul(div(biWidth + 1, 2) * 2, biHeight);
    if (fileSize < BITMAP_FILE_HEADER_SIZE + BITMAP_INFO_HEADER_SIZE + 4 * numColor + bmpsize) {
      if (!this.firstTime) return false;
      this.trace('Incomplete Overlay Bitmap');
      return false;
    }
    if (bmpsize > OVERLAY_HEIGHT * OVERLAY_WIDTH) {
      if (this.firstTime) {
        this.trace('Overlay too big');
        this.firstTime = false;
      }
      return false;
    }
    this.current.Allocate();
    this.current.overlay!.set(fileData.subarray(pixels, pixels + bmpsize));
    const palette = this.current.overlayPalette!;
    for (let i = 0; i < Math.min(numColor, 256); i++) palette[i] = readU32LE(fileData, colors + 4 * i);
    this.current.p1 = 0;
    this.current.p2 = 0;
    this.current.p3 = 0;
    this.current.p4 = 0;
    return true;
  }

  /**
   * `SelectOverlay(onum, p1, p2, p3, p4)` (`doc/CSBwin-src/Bitmaps.cpp:687-720`): overlay
   * `onum` read, unless it is already the one in memory, and drawn if it was read. A
   * change of `p1`'s bit 1 mirrors it. A `p3` of 0 keeps the end it had; another ends it
   * `p3` ticks from `time`.
   */
  SelectOverlay(onum: number, p1: number, p2: number, p3: number, p4: number, time: number): void {
    const current = this.current;
    if (current.overlayNumber !== onum) {
      if (this.ReadOverlay(onum)) {
        current.overlayNumber = onum;
        this.active = true;
      } else {
        this.active = false;
      }
    } else {
      this.active = true;
    }
    if (((current.p1 ^ p1) & 2) !== 0) current.Mirror();
    current.p1 = p1;
    current.p2 = p2;
    if (p3 !== 0) current.p3 = (time + p3) | 0;
    current.p4 = p4;
  }

  /**
   * `SetOverlayPalette(onum, p1, p2, density)` (`doc/CSBwin-src/Bitmaps.cpp:651-685`): a
   * negative `onum` clears the overlay palette to the identity (`ClearOverlayPalette`);
   * another blends section `onum` of `CGT_OverlayPalette`, 512 RGB555 words, into it,
   * `density` percent of the section's to the rest of what it held. A missing section
   * changes nothing. `p1` and `p2` are not read.
   */
  SetOverlayPalette(onum: number, density: number): void {
    const transparency = 100 - density;
    if (onum < 0) {
      this.overlayPalette.set(identityOverlayPalette());
      return;
    }
    const result = this.csbGraphics?.readSection(CSBGraphicType.OverlayPalette, onum, 1024) ?? null;
    if (result === null) return;
    const blend = (old: number, intensity: number): number =>
      div((Math.imul(old, transparency) + Math.imul(intensity, density) + 50) | 0, 100) & 0xff;
    const palette = this.overlayPalette;
    for (let i = 0; i < 512; i++) {
      const word = readU16LE(result, 2 * i);
      let intensity = (word >> 7) & 0xf8;
      intensity |= intensity >> 5;
      palette[i] = blend(palette[i]!, intensity);
      intensity = (word >> 2) & 0xf8;
      intensity |= intensity >> 5;
      palette[512 + i] = blend(palette[512 + i]!, intensity);
      intensity = (word << 3) & 0xf8;
      intensity |= intensity >> 5;
      palette[1024 + i] = blend(palette[1024 + i]!, intensity);
    }
  }

  /**
   * `STKOP_Jitter` (`doc/CSBwin-src/DSA.cpp:4904-4931`): the overlay's and the graphic's
   * shift, as the DSA pops them.
   */
  Jitter(xGraphic: number, yGraphic: number, xOverlay: number, yOverlay: number): void {
    this.xGraphicJitter = xGraphic;
    this.yGraphicJitter = yGraphic;
    this.xOverlayJitter = xOverlay;
    this.yOverlayJitter = yOverlay;
  }

  /**
   * The overlay's end, after each `d.Time++`: the main loop's (`doc/CSBwin-src/CSBCode.cpp:685`)
   * and a script's tick's (`Attack.cpp:2211`). It stays in memory, and its `m_p3` with it.
   */
  expire(time: number): void {
    if (this.current.p3 !== 0 && this.current.p3 < time) this.active = false;
  }

  /**
   * `currentOverlay.Cleanup()` at the start of `_ReadEntireGame` (`doc/CSBwin-src/SaveGame.cpp:1573`),
   * then `ReadExtendedFeatures`' overlay (`:425-438`), for a new game's `dungeon.dat` as
   * for a save. A file without the block leaves `overlayActive` as it was. With one, the
   * flag sets it, and an overlay it names is selected again, which draws it whatever the
   * flag said; its end, saved as a `d.Time`, comes back as one, for `d.Initialize()` has
   * set `d.Time` to 0 before every read (`CSBCode.cpp:356`).
   */
  readExtendedFeatures(efb: ExtendedFeaturesBlock | undefined): void {
    this.current.Cleanup();
    if (!efb) return;
    this.active = (efb.extendedFlags & EF_EXTENDED_FLAGS.OverlayActive) !== 0;
    if (efb.overlayOrdinal > 0) {
      this.SelectOverlay(efb.overlayOrdinal - 1, efb.overlayP1, efb.overlayP2, efb.overlayP3, efb.overlayP4, 0);
    }
  }

  /** What `SaveGame` writes of the overlay into the Extended Features block (`SaveGame.cpp:993-1001`). */
  toExtendedFeatures(): SavedOverlay {
    return {
      active: this.active,
      overlayOrdinal: this.current.overlayNumber + 1,
      overlayP1: this.current.p1,
      overlayP2: this.current.p2,
      overlayP3: this.current.p3,
      overlayP4: this.current.p4,
    };
  }
}
