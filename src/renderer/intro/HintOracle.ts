/**
 * Chaos Strikes Back's Hint Oracle — `_StartHint`, `doc/CSBwin-src/Hint.cpp:6454`.
 *
 * CSBWin runs it from its launcher's HINT choice, as a program of its own (`HINT.FTL` on
 * the utility disk). Here it opens on a square, the party's, and its first screen is the
 * titles of the hints that apply there. Like the other screens in this directory it
 * draws straight to the screen over an `IntroHost`, and every `await` on a VBL is one of
 * `Hint.cpp`'s `RESTART` labels.
 *
 * What is ported, in `_StartHint`'s loop (`:6513-6633`), which keeps the screen in `w_4`:
 *
 * - 2, the title list (`_TAG00799a_6`, `:5979-6053`), or "There are no clues for this
 *   location." with DONE alone (`:6553`). DONE closes the Oracle.
 * - 4, a hint's page (`_TAG007fdc_36`), with NEXT while pages remain and LAST past the
 *   first. DONE goes back to the title list (`:6584-6602`).
 *
 * Not ported: the load screen with its floppy prompts and the save chooser, which only
 * lead to the square (`TAG006c7e_9(501)`, `:6529`); the save's checksums; Dump and
 * `HINTDUMP.TXT`; and the OK/CANCEL error screen, which `UI_Die` makes unreachable. The
 * screen starts at the load's own window (`_TAG0051c2_1`) and the lookup
 * (`_TAG00799a_9`). See `doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "The screen".
 *
 * Every screen is built by `_TAG0051c2_31` over two buffers, the one shown and the one
 * drawn (`f.Pointer16506`, `f.Word16498`): button labels, fades, a swap, the texts of
 * list 9 (`f.pBook14608[9]`), a swap and the last fades. A text is `_DisplayText`'s,
 * drawn in the ink `TAG004a22_26` recolours the font to. A click is queued by
 * `TAG001afe` against the buttons enabled when it comes, and a button pressed flashes
 * (`_TAG008c40_8`).
 */
import { hintsAtPosition, MAXHINTINDICES, type HcsbDat, type HintOracle } from '../../data/HintOracleLoader';
import { fillRectIndex } from '../csbwin/CanvasBlitter';
import type { Rect } from '../../data/tables/UITables';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import type { IntroHost } from './IntroHost';

/** What the Oracle asks of the machine: the screen, the colour registers, the VBL and the mouse. */
export type HintOracleHost = Pick<IntroHost, 'screen' | 'globalPalette' | 'present' | 'vbl' | 'takeClick' | 'discardAllInput'>;

/** The square the Oracle answers for: `partyLevel`, `partyX` and `partyY` (`Hint.cpp:6100-6105`). */
export interface HintSquare {
  level: number;
  x: number;
  y: number;
}

/** `struct TEXT` (`Hint.cpp:106`): a string drawn wrapped in a rectangle, centred when `w14 & 1`. */
interface Text {
  pnt2: string;
  rectPos6: Rect;
  w14: number;
}

/**
 * `struct S20` (`Hint.cpp:85`), one of `s20_16208`'s buttons. `w0` is read by nothing,
 * and `w12`, the key word, is 0 in every row, so `TAG008c40_3` registers no key (`:6824`).
 */
interface S20 {
  /** The button's id, the number `_StartHint` switches on. */
  b2: number;
  b3: number;
  rectPos4: Rect;
  /** Its label, set at run time for the title lines (`TAG008c40_12(…, 5, title)`). */
  pnt14: string | null;
  /** The ink its label is drawn in after a flash (`TAG008c40_12(…, 6)`). */
  w18: number;
}

const s20 = (b2: number, x1: number, x2: number, y1: number, y2: number, pnt14: string | null, w18: number): S20 =>
  ({ b2, b3: 0, rectPos4: { x1, x2, y1, y2 }, pnt14, w18 });

/** `s20_16208` (`Hint.cpp:417-439`). */
const S20_16208: readonly S20[] = [
  s20(0x01, 0x7f, 0x0c2, 0xb3, 0xc0, 'LOAD', 1),
  s20(0x03, 0x21, 0x064, 0xb3, 0xc0, 'LAST', 1),
  s20(0x08, 0x21, 0x064, 0xb3, 0xc0, 'Dump', 1),
  s20(0x04, 0x7f, 0x0c2, 0xb3, 0xc0, 'NEXT', 1),
  s20(0x05, 0xdd, 0x121, 0xb3, 0xc0, 'DONE', 1),
  s20(0x0a, 0x28, 0x118, 0x1e, 0x2a, null, 2),
  s20(0x0b, 0x28, 0x118, 0x2e, 0x3a, null, 2),
  s20(0x0c, 0x28, 0x118, 0x3e, 0x4a, null, 2),
  s20(0x0d, 0x28, 0x118, 0x4e, 0x5a, null, 2),
  s20(0x0e, 0x28, 0x118, 0x5e, 0x6a, null, 2),
  s20(0x0f, 0x28, 0x118, 0x6e, 0x7a, null, 2),
  s20(0x10, 0x28, 0x118, 0x7e, 0x8a, null, 2),
  s20(0x11, 0x28, 0x118, 0x8e, 0x9a, null, 2),
  s20(0x06, 0x7f, 0x0c2, 0xb3, 0xc0, 'OK', 1),
  s20(0x02, 0xdd, 0x121, 0xb3, 0xc0, 'EXIT', 1),
  s20(0x00, 0x00, 0x000, 0x00, 0x00, null, 0),
  s20(0x07, 0xdd, 0x121, 0xb3, 0xc0, 'CANCEL', 1),
  s20(0x06, 0x00, 0x021, 0xb3, 0xc0, null, 1),
  s20(0x00, 0x00, 0x000, 0x00, 0x00, null, 0),
  s20(0x00, 0x00, 0x000, 0x00, 0x00, null, 0),
];

/** The buttons `_StartHint` switches on. */
export const HINT_BUTTON = {
  LAST: 3,
  NEXT: 4,
  DONE: 5,
  /** The first title line; the eighth is 17. */
  FIRST_TITLE: 10,
} as const;

/** The id's rectangle: `TAG008c40_12(P1, id, 3, NULL)`, null where CSBWin gets -1. */
export function hintButtonRect(id: number): Rect | null {
  return S20_16208.find((b) => b.b2 === id)?.rectPos4 ?? null;
}

/** `text15024[4]` (`Hint.cpp:474-485`), the screen of a square with no hints. */
const TEXT_NO_CLUES: Text = { pnt2: 'There are no clues for this location.', rectPos6: { x1: 0x1f, x2: 0x122, y1: 0x46, y2: 0x96 }, w14: 1 };

/** `rectPos14516` (`Hint.cpp:514`): the whole screen, the rectangle `TAG004a22_16` gives a new text. */
const RECT_POS_14516: Rect = { x1: 0, x2: 0x13f, y1: 0, y2: 0xc7 };

/**
 * `byte16544` (`Hint.cpp:389`): the colour map the ink is set through, ten times the
 * colour, as `ShrinkBLT` reads it. A static in CSBWin, which a second run of the Oracle
 * finds as the first left it, with `word15708`; the port starts each run afresh. Either
 * way the font's glyphs end up in the current ink, because `byte16544[9]` holds the
 * first build's ink (word 2, 1), the same colour as the load's first call gives
 * (word 10, 1).
 */
const BYTE16544: readonly number[] = [0x00, 0x0a, 0x14, 0x1e, 0x28, 0x32, 0x3c, 0x46, 0x50, 0x5a, 0x64, 0x6e, 0x78, 0x82, 0x8c, 0x96];

/** `byte16528` (`Hint.cpp:395`): `byte16544` with colour 12 sent to 9, for the title lines. */
const BYTE16528: readonly number[] = [0x00, 0x0a, 0x14, 0x1e, 0x28, 0x32, 0x3c, 0x46, 0x50, 0x5a, 0x64, 0x6e, 0x5a, 0x82, 0x8c, 0x96];

/** `word16494` and `word16488` (`Hint.cpp:401-402`): each component's mask, and its unit. */
const WORD16494 = [0x700, 0x070, 0x007];
const WORD16488 = [0x100, 0x010, 0x001];

/** The font's width, 256, and its transparent colour (`TAG004962`, `Hint.cpp:3466-3473`). */
const FONT_WIDTH = 256;
const FONT_TRANSPARENT = 12;
/** `TAG004962`'s glyph: 8 wide, 9 high, 9 apart along a line. */
const GLYPH_WIDTH = 8;
const GLYPH_HEIGHT = 9;
const GLYPH_ADVANCE = 9;
/** `_DisplayText`'s lines, 11 apart, the first 11 below the rectangle's top (`:3524`, `:3599`). */
const LINE_PITCH = 11;

/** A page of `f.pBook14608[9]`, the texts the next build draws (`TAG00978a_27`). */
interface TextPage {
  i4: number;
  pText8: Text;
  i12: number;
}

/** `S6`, one click of `f.s6_14190`, the five-slot queue. */
interface S6 {
  b0: number;
  b1: number;
  w2: number;
  w4: number;
}

/** `T12` (`Hint.cpp:77`), an enabled button of `t12_14106`. */
interface T12 {
  b0: number;
  b1: number;
  rectPos2: Rect;
  w10: number;
}

/** `clickMap13914.b0` (`Hint.cpp:535`), which `TAG001dde` hands back as a click's high byte. */
const CLICK_MAP_B0 = 0x0a;

/** The Oracle's state, CSBWin's `f` (`Hint.cpp:187-382`), for one run. */
export class HintOracleScreen {
  /** `f.Segment1_16872`, item 0's fifty words. */
  private readonly seg: readonly number[];
  /** `f.Palette16608`, item 3 to start with. */
  private readonly palette16608: number[];
  /** `f.Pointer16900`, the backdrop. */
  private readonly backdrop: Uint8Array;
  /** `f.Pointer16908`, the font, recoloured in place. */
  private readonly font: Uint8Array;
  private readonly byte16544 = Uint8Array.from(BYTE16544);
  /** `word15708`, the current ink: -1 until the first `TAG004a22_26`. */
  private word15708 = -1;
  /** `f.Pointer16506`: the two screens. */
  private readonly pointer16506: [Uint8Array, Uint8Array];
  /** `f.Word16498`: `pointer16506[word16498]` is drawn, the other shown. */
  private word16498 = 0;
  /** `f.Pointer12798`: where the drawing goes. */
  private pointer12798: Uint8Array;
  private readonly s20: S20[] = S20_16208.map((b) => ({ ...b }));
  /** `t12_14106[0 … f.Word13900 - 1]`. */
  private t12: T12[] = [];
  private readonly s6_14190: S6[] = Array.from({ length: 5 }, () => ({ b0: 0, b1: 0, w2: 0, w4: 0 }));
  private word14202 = 4;
  private word14204 = 0;
  private book9: TextPage[] = [];
  /** `f.pBook14608[19]`: the title lines, remapped once a title list is up. */
  private book19: Rect[] = [];
  /** `VBLCount`, as the Oracle counts it. */
  vblCount = 0;
  private long14110 = 0;
  private word14112 = 0;
  private long16876 = 0;
  /** `f.NumHint10552` and `f.HintIndices10530`. */
  numHint10552 = 0;
  hintIndices10530: number[] = [];
  /** `f.Word10516`, the title line chosen. */
  word10516 = 0;
  /** `f.CurPage10484`, the page shown, from 1. */
  curPage10484 = 0;
  /** `f.Word10482`, the title line whose pages are shown. */
  private word10482 = 0;
  /** `w_4`, the screen: 2 the title list, 4 a page. */
  w_4 = 0;
  /** In `_TAG008c40_5`, waiting for a button. */
  waiting = false;

  constructor(
    private readonly host: HintOracleHost,
    private readonly oracle: HintOracle,
    dat: HcsbDat,
    private readonly square: HintSquare,
  ) {
    this.seg = dat.segment1;
    this.palette16608 = dat.palette.slice();
    this.backdrop = dat.backdrop.pixels;
    this.font = Uint8Array.from(dat.font.pixels);
    // `f.Pointer16506[0] = logbase()`: the screen as it is; [1] a buffer of its own.
    this.pointer16506 = [Uint8Array.from(host.screen.pixels), new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)];
    this.pointer12798 = this.pointer16506[0];
  }

  /** The buttons enabled, in `t12_14106`'s order. */
  enabledButtons(): number[] {
    return this.t12.map((t) => t.b0);
  }

  /** The title lines' texts, as their buttons carry them. */
  titles(): string[] {
    return this.hintIndices10530.slice(0, Math.min(this.numHint10552, MAXHINTINDICES)).map((i) => this.oracle.hints[i]!.title);
  }

  /** `_StartHint`, from the load's window to DONE on the title list. */
  async run(): Promise<void> {
    await this.tag0051c2_1();
    this.tag008c40_1();
    this.tag00799a_9();
    this.w_4 = 2;
    this.tag008c40_3(HINT_BUTTON.DONE);
    if (this.numHint10552 > 0) await this.tag00799a_6();
    else await this.tag004e4c_6(TEXT_NO_CLUES);
    for (;;) {
      let w_2 = await this.tag008c40_5(this.w_4);
      w_2 = await this.tag008c40_8(w_2);
      switch (w_2) {
        case 10: case 11: case 12: case 13: case 14: case 15: case 16: case 17:
          this.w_4 = 4;
          this.word10516 = w_2 - 10; // `SetSelectedLine`
          await this.tag007fdc_36(w_2 - 10, 0);
          break;
        case HINT_BUTTON.DONE:
          // On the title list CSBWin goes back to the load screen; the Oracle closes
          // instead. `TAG0051c2_2` puts the program's screen back, which is the caller's.
          if (this.w_4 !== 4) return;
          this.w_4 = 2;
          this.tag008c40_3(HINT_BUTTON.DONE);
          await this.tag00799a_6();
          break;
        case HINT_BUTTON.LAST:
        case HINT_BUTTON.NEXT:
          await this.tag007fdc_36(0, w_2 !== HINT_BUTTON.LAST ? 1 : -1);
          break;
        default:
          break;
      }
    }
  }

  /* ------------------------------------------------------------ the screen ---- */

  /** `f.Pointer16506[!f.Word16498]`, the screen shown. */
  private front(): Uint8Array {
    return this.pointer16506[this.word16498 === 0 ? 1 : 0];
  }

  private present(): void {
    this.host.screen.pixels.set(this.front());
    this.host.present();
  }

  /** What was drawn shows at once if it went to the screen shown (`TAG0051c2_36`). */
  private presentIfFront(): void {
    if (this.pointer12798 === this.front()) this.present();
  }

  /** `setpalette`: the colour registers. */
  private setpalette(palette: readonly number[]): void {
    for (let i = 0; i < 16; i++) this.host.globalPalette[i] = palette[i] ?? 0;
    this.present();
  }

  /**
   * `wvbl()`, `count` times. A click that came meanwhile is queued by `TAG001afe`, as
   * CSBWin's message pump does between two steps of the coroutine.
   */
  private async wvbl(count = 1): Promise<void> {
    await this.host.vbl(count);
    this.vblCount += count;
    for (let event = this.host.takeClick(); event; event = this.host.takeClick()) this.tag001afe(event.x, event.y, 1);
  }

  /** `TAG0088b8(&rectPos14516, f.Pointer16900, 1)`: the backdrop over the screen drawn. */
  private drawBackdrop(): void {
    this.pointer12798.set(this.backdrop.subarray(0, this.pointer12798.length));
  }

  /** `TAG0051c2_35` (`Hint.cpp:4256`): the screen drawn is shown, and the other gets the backdrop. */
  private tag0051c2_35(): void {
    this.word16498 = this.word16498 === 0 ? 1 : 0;
    this.present();
    this.pointer12798 = this.pointer16506[this.word16498];
    this.drawBackdrop();
  }

  /** `TAG0051c2_36` (`:4316`): draw on the screen shown. */
  private tag0051c2_36(): void {
    this.pointer12798 = this.front();
  }

  /** `TAG0051c2_37` (`:4338`): draw on the other. */
  private tag0051c2_37(): void {
    this.pointer12798 = this.pointer16506[this.word16498];
  }

  /**
   * `_FadePalette` (`Hint.cpp:4576-4660`) with the screen's palette as the start and the
   * mask 273, all three components: `steps` steps, each moving every component one unit
   * toward `target`, then `delay` VBLs.
   */
  private async fadePalette(target: readonly number[], delay: number, steps: number): Promise<void> {
    const w34 = this.host.globalPalette.slice(0, 16);
    for (let p5 = steps; p5 !== 0; p5--) {
      for (let i = 0; i < 16; i++) {
        for (let c = 0; c < 3; c++) {
          const d5 = w34[i]! & WORD16494[c]!;
          const d4 = (target[i] ?? 0) & WORD16494[c]!;
          if (d4 === d5) continue;
          w34[i] = d5 < d4 ? w34[i]! + WORD16488[c]! : w34[i]! - WORD16488[c]!;
        }
      }
      if (delay !== 0) this.setpalette(w34);
      if (delay !== 0) await this.wvbl(delay);
    }
    if (delay === 0) this.setpalette(w34);
  }

  /**
   * `_TAG0051c2_1` (`Hint.cpp:3989-4100`), past the read of `hcsb.dat`: the font's first
   * ink, a fade to black (`f.Palette16640`, which nothing writes), the backdrop on both
   * screens, and a fade to item 3. The two fades take 2 and 7 as constants.
   */
  private async tag0051c2_1(): Promise<void> {
    this.tag004a22_26(this.seg[10]!, this.seg[8]!);
    await this.fadePalette(new Array(16).fill(0), 2, 7);
    this.word16498 = 1;
    this.pointer12798 = this.pointer16506[1];
    this.drawBackdrop();
    this.tag0051c2_35();
    await this.fadePalette(this.palette16608, 2, 7);
  }

  /**
   * `_TAG0051c2_31` (`Hint.cpp:4171-4251`), a screen built: the labels drawn, the old
   * screen faded with item 0's slot (word 0) at word 1, a swap, the labels again and list
   * 9's texts, the slot at word 3, at least word 9's VBLs since the swap, another swap,
   * and the fades to the new screen.
   */
  private async tag0051c2_31(): Promise<void> {
    const seg = this.seg;
    this.tag004a22_26(seg[2]!);
    await this.tag008c40_6();
    // `TAG005ae8_9`: the screen's palette into `f.Palette16608`.
    for (let i = 0; i < 16; i++) this.palette16608[i] = this.host.globalPalette[i]!;
    this.palette16608[seg[0]!] = seg[1]!;
    await this.fadePalette(this.palette16608, seg[12]!, seg[13]!);
    await this.fadePalette(this.palette16608, seg[10]!, seg[11]!);
    this.clearKeyboard();
    this.tag0051c2_35();
    this.long16876 = this.vblCount;
    this.tag004a22_26(seg[2]!);
    await this.wvbl();
    await this.tag008c40_6(); // "Text appears on buttons"
    this.tag004a22_26(seg[0]!);
    for (let w48 = this.book9.length; w48 > 0; w48--) {
      const page = this.book9[w48 - 1]!;
      await this.displayText(page.pText8);
      if (page.i12 === 8) this.tag005f9a_1(page.pText8.rectPos6, seg[6]!);
      this.book9.splice(w48 - 1, 1);
    }
    this.palette16608[seg[0]!] = seg[3]!;
    do {
      await this.wvbl();
    } while (this.long16876 + seg[9]! > this.vblCount);
    this.tag0051c2_35();
    await this.fadePalette(this.palette16608, seg[10]!, seg[11]!); // "Yellow rectangles appear"
    await this.fadePalette(this.palette16608, seg[12]!, seg[13]!);
    this.tag004a22_26(seg[4]!);
  }

  /**
   * `TAG005f9a_1(rect, colour, -1)` (`Hint.cpp:4666-4737`): a frame one pixel wide just
   * outside `rect`, in `colour`.
   */
  private tag005f9a_1(rect: Rect, colour: number): void {
    const r = { x1: rect.x1 - 1, x2: rect.x2 + 1, y1: rect.y1 - 1, y2: rect.y2 + 1 }; // `ExpandRectangle`
    const target = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, pixels: this.pointer12798 };
    fillRectIndex(target, { ...r, x2: r.x1 }, colour);
    fillRectIndex(target, { ...r, x1: r.x2 }, colour);
    fillRectIndex(target, { ...r, y2: r.y1 }, colour);
    fillRectIndex(target, { ...r, y1: r.y2 }, colour);
  }

  /**
   * `TAG0062a2(rect, map)` (`Hint.cpp:4785-4802`): the rectangle copied out of the screen
   * drawn on, through `map` with `ShrinkBLT`, and back.
   *
   * The copy's lines are `TAG0088b8`'s, `(w + 16) / 16` sixteen-pixel groups for a
   * rectangle `w + 1` pixels wide, but `ShrinkBLT` is told `w` by `h` pixels and takes its
   * own lines, `(w + 15) / 16` groups: on a title line, 240 pixels where the copy's are
   * 256. So it remaps the first `h` of its own lines of the buffer, laid end to end, which
   * is the copy's first eleven lines and the start of its twelfth, a pixel past `w` on
   * each of its lines going to 0. Both copies are the whole `w + 1` by `h + 1`.
   */
  private tag0062a2(rect: Rect, map: readonly number[]): void {
    const w = rect.x2 - rect.x1;
    const h = rect.y2 - rect.y1;
    const stride = ((w + 16) >> 4) * 16;
    const buffer = new Uint8Array(stride * (h + 1));
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= w; x++) buffer[y * stride + x] = this.pointer12798[(rect.y1 + y) * SCREEN_WIDTH + rect.x1 + x]!;
    }
    const line = (w + 15) & ~15;
    for (let k = 0; k < line * h; k++) buffer[k] = k % line < w ? Math.floor(map[buffer[k]! & 15]! / 10) : 0;
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= w; x++) this.pointer12798[(rect.y1 + y) * SCREEN_WIDTH + rect.x1 + x] = buffer[y * stride + x]!;
    }
    this.presentIfFront();
  }

  /* -------------------------------------------------------------- the text ---- */

  /**
   * `TAG004a22_26(P1, nP2, nP3)` (`Hint.cpp:3694-3734`), the ink: the current ink's slot
   * of `byte16544` gets the new colour, and the font is passed through the map in place
   * (`TAG0025a0`, `ShrinkBLT` at full size). The first call, with no ink yet, sets slot
   * `nP2` to `nP3` and makes `nP3` current.
   */
  private tag004a22_26(nP2: number, nP3 = 0x1baddade): void {
    if (this.word15708 === -1) {
      this.byte16544[nP2] = 10 * (nP3 & 0xff);
      this.word15708 = nP3;
    } else {
      this.byte16544[this.word15708] = 10 * (nP2 & 0xff);
      this.word15708 = nP2;
    }
    for (let i = 0; i < this.font.length; i++) this.font[i] = Math.floor(this.byte16544[this.font[i]! & 15]! / 10);
  }

  /**
   * `TAG004962(x, y, line)` (`Hint.cpp:3446-3477`): a line of glyphs with its baseline at
   * `y`, 9 apart, colour 12 transparent. A space draws nothing.
   */
  private tag004962(p1: number, p2: number, line: number[]): void {
    for (let x1 = p1, k = 0; k < line.length && line[k] !== 0; k++, x1 += GLYPH_ADVANCE) {
      const b9 = line[k]! - 32;
      if (b9 === 0) continue;
      const srcX = 8 * (b9 & 0x1f);
      const srcY = 9 * Math.trunc(b9 / 32);
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const to = (p2 - 8 + row) * SCREEN_WIDTH + x1;
        for (let col = 0; col < GLYPH_WIDTH; col++) {
          const v = this.font[(srcY + row) * FONT_WIDTH + srcX + col]!;
          if (v === FONT_TRANSPARENT) continue;
          if (to + col >= 0 && to + col < this.pointer12798.length) this.pointer12798[to + col] = v;
        }
      }
    }
  }

  /** `TAG0049fe` (`Hint.cpp:3482`): the width of characters `p2` to `p3`, 9 for none. */
  private static tag0049fe(p2: number, p3: number): number {
    return p3 >= p2 ? GLYPH_ADVANCE * (p3 - p2 + 1) : GLYPH_ADVANCE;
  }

  /**
   * `_DisplayText` (`Hint.cpp:3497-3608`): `text` wrapped at its rectangle's width, a
   * line `LINE_PITCH` below the last, `/` breaking a line, centred if `w14 & 1`, a line
   * below the rectangle not drawn, and a byte outside 32-127 drawn as `_`. Then a VBL.
   */
  private async displayText(text: Text): Promise<void> {
    const s = Array.from(text.pnt2, (c) => c.charCodeAt(0) & 0xff);
    const at = (i: number): number => s[i] ?? 0;
    const width = text.rectPos6.x2 - text.rectPos6.x1; // `f.Word15700`
    let y = text.rectPos6.y1 + LINE_PITCH; // `f.Word15698`
    const line: number[] = []; // `f.Byte15788`
    let i = 0; // `f.Word15706`
    while (i < s.length) {
      if (at(i) === 0x20) { i++; continue; }
      const start = i; // `f.Word15704`
      for (;;) {
        const c = i >= s.length ? 0x20 : at(i);
        line[i - start] = c;
        if (c === 0x20) {
          if (HintOracleScreen.tag0049fe(start, i - 1) > width) {
            for (i--; i > start; i--) if (line[i - start] === 0x20) break;
            if (i !== start) break;
            do {
              i++;
            } while (HintOracleScreen.tag0049fe(start, i) < width);
            i--;
            break;
          }
          if (i >= s.length) break;
          i++;
        } else {
          if (c === 0x2f) { line[i - start] = 0; break; }
          i++;
        }
      }
      line[i - start] = 0;
      let x = text.rectPos6.x1; // `f.Word15696`
      if (text.w14 & 1) x += Math.trunc((width - HintOracleScreen.tag0049fe(start, i - 1)) / 2);
      if (y <= text.rectPos6.y2) {
        for (let k = 0; line[k] !== 0; k++) if (line[k]! < 0x20 || line[k]! > 127) line[k] = 95;
        this.tag004962(x, y, line);
      }
      y += LINE_PITCH;
      if (at(i) === 0x2f) i++;
    }
    this.presentIfFront();
    await this.wvbl();
  }

  /** `TAG004e4c_6(P1, text)` (`Hint.cpp:3739-3784`): a screen of one text. */
  private async tag004e4c_6(text: Text): Promise<void> {
    this.book9.push({ i4: 34, pText8: text, i12: 6 });
    await this.tag0051c2_31();
  }

  /* ----------------------------------------------------------- the buttons ---- */

  /** `TAG008c40_12(P1, id, 0)` (`Hint.cpp:7008`): the id's row of `s20_16208`, or -1. */
  private rowOf(id: number): number {
    return this.s20.findIndex((b) => b.b2 === id);
  }

  /** `TAG008c40_1` (`Hint.cpp:6756`): no buttons, and `EnableButtons`' `ClearKeyboard`. */
  private tag008c40_1(): void {
    this.t12 = [];
    this.clearKeyboard();
  }

  /** `TAG008c40_3(P1, id, 0)` (`Hint.cpp:6793-6832`): the button enabled. */
  private tag008c40_3(id: number): void {
    const row = this.rowOf(id);
    if (row < 0) return;
    const b = this.s20[row]!;
    if (b.rectPos4.x1 !== 0 && b.rectPos4.x2 !== 0) this.t12.push({ b0: b.b2, b1: b.b3, rectPos2: { ...b.rectPos4 }, w10: 1 });
  }

  /** `_TAG008c40_6(P1, 0)` (`Hint.cpp:6911-6946`): every enabled button's label, `_TAG0089b0`. */
  private async tag008c40_6(): Promise<void> {
    for (const t of this.t12) {
      const b = this.s20[this.rowOf(t.b0)]!;
      if (b.pnt14 === null || b.w18 === 0) continue;
      await this.displayText({ pnt2: b.pnt14, rectPos6: { ...b.rectPos4 }, w14: 1 });
    }
  }

  /** `ClearKeyboard` (`Hint.cpp:1937`): the keys read, and the click queue emptied. */
  private clearKeyboard(): void {
    this.host.discardAllInput();
    this.word14204 = 0;
    this.word14202 = 4;
  }

  /**
   * `TAG001afe(x, y, mask)` (`Hint.cpp:1975-2021`): a click queued as the first enabled
   * button under it, if any. Either mouse button gives mask 1 (`CSBUI.cpp:1194-1220`),
   * which every button takes. A queue of five whose full test never holds: a sixth click
   * unread writes over the first.
   */
  private tag001afe(x: number, y: number, mask: number): void {
    let d5 = this.word14202 + 2;
    if (d5 > 4) d5 -= 5;
    if (d5 === this.word14202) return;
    const hit = this.t12.find((t) => x <= t.rectPos2.x2 && x >= t.rectPos2.x1 && y <= t.rectPos2.y2 && y >= t.rectPos2.y1 && (mask & t.w10) !== 0);
    if (!hit) return;
    d5 = d5 === 0 ? 4 : d5 - 1;
    this.word14202 = d5;
    Object.assign(this.s6_14190[d5]!, { b0: hit.b0, b1: 0, w2: x, w4: y });
  }

  /** `_TAG001dde` (`Hint.cpp:2153-2205`): a VBL, then the oldest click, `(map << 8) | id`, or 0. */
  private async tag001dde(): Promise<number> {
    await this.wvbl();
    let d7 = this.word14202 + 1;
    if (d7 > 4) d7 = 0;
    if (d7 === this.word14204) return 0;
    const s6 = this.s6_14190[this.word14204]!;
    this.word14204++;
    if (this.word14204 > 4) this.word14204 = 0;
    return s6.b0 === 0 ? 0 : (CLICK_MAP_B0 << 8) | s6.b0;
  }

  /**
   * `_TAG008c40_5(P1, screen)` (`Hint.cpp:6837-6903`): the wait for a button. On the
   * title list item 0's slot (word 8) steps through the cycle's colours, words 36 on, at
   * most once every 20 VBLs; a button pressed puts it back at word 36.
   */
  private async tag008c40_5(nP2: number): Promise<number> {
    const seg = this.seg;
    this.long14110 = this.vblCount;
    // CSBWin spins on `f.Word12822`, which nothing sets, with no button up.
    if (this.t12.length === 0) throw new Error('Hint Oracle: waiting for a button with none up');
    this.waiting = true;
    try {
      for (;;) {
        const d6 = (await this.tag001dde()) & 0xff;
        if (d6 !== 0) {
          if (nP2 === 2) {
            this.palette16608[seg[8]!] = seg[36]!;
            this.setpalette(this.palette16608);
          }
          return d6;
        }
        if (nP2 === 2 && this.long14110 + 20 < this.vblCount) {
          this.long14110 = this.vblCount;
          this.palette16608[seg[8]!] = seg[this.word14112 + 36]!;
          this.word14112 = (this.word14112 + 1) % seg[32]!;
          this.setpalette(this.palette16608);
        }
      }
    } finally {
      this.waiting = false;
    }
  }

  /**
   * `_TAG008c40_8(P1, id)` (`Hint.cpp:6951-7003`): the button's label drawn on the
   * screen shown in word 7's ink, 21 VBLs, then again in the button's own, and every
   * button put down.
   *
   * The ink is then reset from `Long16864`, which CSBWin's comment puts at byte 8 of item
   * 0, words 4-5, but reads as `f.Segment1_16872+8`, words 8-9, keeping word 9. The port
   * takes word 5 (`DEBT.md` H). No pixel differs: every text is drawn after an ink set of
   * its own.
   */
  private async tag008c40_8(nP2: number): Promise<number> {
    if (nP2 === 0) return 0;
    const b = this.s20[this.rowOf(nP2)]!;
    // `TAG0093a0_18(P1, 68)`, "Sorry about that".
    if (b.pnt14 === null) throw new Error(`Hint Oracle: button ${nP2} has no label`);
    const text: Text = { pnt2: b.pnt14, rectPos6: { ...b.rectPos4 }, w14: 1 };
    this.tag0051c2_36();
    this.tag004a22_26(this.seg[7]!);
    await this.displayText(text);
    await this.wvbl(21); // `TAG005a1e_5(20)`: `do { wvbl } while (w_2-- != 0)`
    const i8 = b.w18;
    this.tag004a22_26(i8);
    await this.displayText(text);
    this.tag0051c2_37();
    const long16864 = this.seg[5]!;
    if (long16864 !== i8) this.tag004a22_26(long16864);
    this.t12 = []; // `TAG008c40_2`
    return nP2;
  }

  /* ------------------------------------------------------------- the hints ---- */

  /** `_TAG00799a_9` (`Hint.cpp:6071-6124`), past its read of the save: the hints at the square. */
  private tag00799a_9(): void {
    this.hintIndices10530 = hintsAtPosition(this.oracle, this.square.level, this.square.x, this.square.y);
    this.numHint10552 = this.hintIndices10530.length;
  }

  /**
   * `_TAG00799a_6(2)` (`Hint.cpp:5979-6053`), the title list: each title a button and a
   * text of list 9 framed in word 6's colour, item 0's slot (word 8) at word 36, and once
   * the screen is up, colour 12 of each title line sent to 9 (`TAG0062a2`).
   */
  private async tag00799a_6(): Promise<void> {
    const seg = this.seg;
    const count = Math.min(this.numHint10552, MAXHINTINDICES);
    for (let w14 = 0; w14 < count; w14++) {
      const id = w14 + HINT_BUTTON.FIRST_TITLE;
      this.tag008c40_3(id);
      const title = this.oracle.hints[this.hintIndices10530[w14]!]!.title;
      // The ninth title has no row: CSBWin reads its rectangle through -1.
      const row = this.rowOf(id);
      if (row < 0) throw new Error(`Hint Oracle: title ${w14 + 1} has no line`);
      const rect = { ...this.s20[row]!.rectPos4 };
      this.palette16608[seg[8]!] = seg[36]!;
      this.setpalette(this.palette16608);
      this.book19.push(rect);
      this.book9.push({ i4: 20, pText8: { pnt2: title, rectPos6: { ...rect }, w14: 1 }, i12: 8 });
      for (const b of this.s20) if (b.b2 === id) b.pnt14 = title; // `TAG008c40_12(…, 5, title)`
    }
    await this.tag0051c2_31();
    this.tag0051c2_36();
    while (this.book19.length > 0) this.tag0062a2(this.book19.pop()!, BYTE16528);
    this.tag0051c2_37();
  }

  /**
   * `_TAG007fdc_36(P1, line, delta)` (`Hint.cpp:6355-6392`): the hint of title line
   * `line` from its first page, or the page `delta` from the one shown, with DONE, NEXT
   * while pages remain, and LAST past the first.
   *
   * `_TAG007fdc_7` keeps the page's text and the hint's title as `TEXT`s, and puts the
   * page in list 9 (`:6276-6353`); the title it never draws. `_TAG00799a_12` dies on a
   * line or a page past the end (`:6146-6157`), which no button offers.
   */
  private async tag007fdc_36(line: number, delta: number): Promise<void> {
    if (delta === 0) {
      this.curPage10484 = 1;
      this.word10482 = line;
    } else {
      this.curPage10484 += delta;
    }
    const pages = this.oracle.hints[this.hintIndices10530[this.word10482]!]!.pages;
    const page = pages[this.curPage10484 - 1];
    if (this.word10482 > this.numHint10552 || page === undefined) {
      throw new Error(`Hint Oracle: no page ${this.curPage10484} of line ${this.word10482}`);
    }
    this.book9.push({
      i4: 34,
      pText8: { pnt2: page, rectPos6: { x1: RECT_POS_14516.x1 + 34, x2: RECT_POS_14516.x2 - 34, y1: 31, y2: 164 }, w14: 1 },
      i12: 6,
    });
    this.tag008c40_3(HINT_BUTTON.DONE);
    // `TAG00799a_13(4)`: the page count of `f.Word10516`'s hint, the line `SetSelectedLine` chose.
    const pageCount = this.oracle.hints[this.hintIndices10530[this.word10516]!]!.pages.length;
    if (pageCount > this.curPage10484) this.tag008c40_3(HINT_BUTTON.NEXT);
    if (this.curPage10484 > 1) this.tag008c40_3(HINT_BUTTON.LAST);
    await this.tag0051c2_31();
  }
}

/** `_StartHint` on `square`, until DONE on the title list. The screen and palette are left as the Oracle's. */
export async function startHint(host: HintOracleHost, oracle: HintOracle, dat: HcsbDat, square: HintSquare): Promise<void> {
  await new HintOracleScreen(host, oracle, dat, square).run();
}
